const express = require('express');
const bodyparser = require('body-parser');
const mongoose = require('mongoose');
const db_config = require('./config/db');
const moment = require('moment');

const TIME_DELTA = 2; // 2 days delta allowed
const AMOUNT_DELTA = 0.2; // 20% delta multiplier allowed

// App setup
let app = express();
app.use(bodyparser.json());

// DB setup
let Transaction = require('./models/transactions');

mongoose.connect(
    db_config.url,
    { useNewUrlParser: true },
    (err) => {
        if (err) {
            console.log("Failed to connect to database.");
        } else {
            console.log("Database connected.");
        }
    }
);

// Main logic functions

/** 
 * Gets the transaction group name (e.g. All txs from Walmart)
*/
async function getTxGroup(tx) {
    let company_name = tx.name;
    if (company_name.length > 1) {
        let last_space_index = company_name.lastIndexOf(' ');
        if (/\d/.test(company_name.substring(last_space_index))) { // Substring after final space ch has numbers
            company_name = company_name.substring(0, last_space_index);
        }
    }
    return company_name;
}

/**
 *  Upserts post data to DB
*/
async function upsert(body) {
    // This assumes the batch of upserts are all from the same user_id, name
    /*
    - trans_id: Unique identifier for the given transaction (String)
    - user_id: Unique identifier of the user sending the request (String)
    - name: Name of the transaction (String)
    - amount: Amount of the transaction in dollars (Number)
    - date: Date the transaction posted to the account (Date)
    */

    for (let tx of body) {
        // Should validate each field of a tx for empty/nulls?
        tx.company = await getTxGroup(tx)
        Transaction.findOneAndUpdate({ trans_id: tx.trans_id }, tx, { upsert: true })
            .catch((error) => {
                if (error) {
                    console.log(error);
                }
            });
    }
}

/**
 * Function that estimates the next recurring payment and gives a list of past recurring transactions
 */
async function recur() {
    /*
    - name: Exact name of the most recent transaction (String)
    - user_id: Same as above (String)
    - next_amt: Estimated amount of the next transaction (Number)
    - next_date: Estimated date of the next transaction (Date)
    - transactions: All transactions that are part of this recurring transaction group (Array of transactions)
    */

    let table = {};
    let results = await Transaction.find({}).sort({ company: 1, date: 1, name: 1 }).lean(); // Oldest date first

    for (let result of results) {
        if (table[result.company]) { // if tx group already in table
            table[result.company].push(result);
        } else {
            table[result.company] = [result];
        }
    }
    //console.log(table);

    let result = [];

    for (let key in table) {
        await calculateRecurrence(table[key]);
        result.push(await calculateNextPayment(table[key]));
    }


    return result;
}

/**
 * 
 * @param {*} table The table keys are the tx_groups/companies
 */
function calculateRecurrence(tx_group) {
    // Should I only consider recurrence after 3 or more txs?
    if (tx_group.length < 3) {
        return;
    }

    let prev_timestamp = '';
    let prev_interval = 0;
    let interval_in_days = 0;

    let prev_amount = 0;

    for (let i = 0; i < tx_group.length; i++) {
        let tx = tx_group[i];

        //console.log(`current: ${tx.name}`)
        let is_recurring_time = false;
        let is_recurring_amount = false;

        if (!prev_timestamp) {
            prev_timestamp = tx.date;
        } else {
            // Get interval between current and prev tx
            interval_in_days = dateDifference(prev_timestamp, tx.date);

            // Time delta calc
            {
                if (!prev_interval) {
                    prev_interval = interval_in_days;
                }

                let interval_min = prev_interval - TIME_DELTA; // Interval - 2days, implying it came 2 days early
                let interval_max = prev_interval + TIME_DELTA; // Interval + 2 days, implying it came 2 days late

                if (interval_in_days > interval_min && interval_in_days < interval_max) {
                    is_recurring_time = true;
                }
            }
        }

        if (!prev_amount) {
            prev_amount = tx.amount;
        } else {
            if (amountDifference(prev_amount, tx.amount)) {
                is_recurring_amount = true;
            }
        }

        if (is_recurring_time && is_recurring_amount) {
            tx_group[i - 1].is_recurring = true;
            tx_group[i].is_recurring = true;
        }

        prev_amount = tx.amount;
        prev_timestamp = tx.date;
    }
}

/**
 * Calculates the next payment for in the company/tx group
 */
function calculateNextPayment(tx_group) {
    //console.log(tx_group);

    if (!tx_group.length) {
        return {};
    }

    let recurring = [];
    let prev_tx = null;
    let prev_timestamp = '';
    let amount = 0;
    let interval_in_days = 0;
    let recurring_count = 0;

    for (let tx of tx_group) {
        if (tx.is_recurring) {
            recurring_count++;
            amount += tx.amount;
            if (!prev_tx) {
                prev_timestamp = tx.date;
            } else {
                interval_in_days += dateDifference(prev_timestamp, tx.date);
            }

            prev_tx = tx;
            prev_timestamp = tx.date;
            recurring.push(tx);
        }
    }

    if (recurring_count) {
        interval_in_days = Math.round(interval_in_days / recurring_count);
        amount /= recurring_count;

        prev_timestamp = new Date(Date.parse(prev_timestamp) + interval_in_days * 24 * 60 * 60 * 1000);
    }

    /*
    - name: Exact name of the most recent transaction (String)
    - user_id: Same as above (String)
    - next_amt: Estimated amount of the next transaction (Number)
    - next_date: Estimated date of the next transaction (Date)
    - transactions: All transactions that are part of this recurring transaction group (Array of transactions)
    */

    return {
        name: (prev_tx) ? prev_tx.name : '',
        user_id: (prev_tx) ? prev_tx.user_id : '',
        next_amt: amount,
        next_date: prev_timestamp,
        transaction: recurring
    };
}

/**
 * Helper function that gets the number of days between timestamps
 */
function dateDifference(date_a, date_b) {
    // let diff = Math.abs(date_a - date_b);
    // return diff < 172800000; // 2 days
    return Math.abs(moment(date_a).diff(moment(date_b), 'days'));
}

/**
 * Helper function the determines if the current amount is > 80% of prev and < 120% of prev
 */
function amountDifference(prev_amount, current_amount) {
    let amount_min = prev_amount - prev_amount * AMOUNT_DELTA; // 80%
    let amount_max = prev_amount + prev_amount * AMOUNT_DELTA; // 120%

    return current_amount > amount_min && current_amount < amount_max;
}

// Path configs

/**
 * Root GET path, gets recurring txs
 */
app.get('/', (req, res) => {
    recur().then((r) => {
        console.log(r);
        res.json(r);
    });
});

/**
 * Root POST path, upserts txs and gets recurring txs
 */
app.post('/', (req, res) => {
    upsert(req.body)
        .then(() => {
            return recur();
        }).then((recur) => {
            console.log(recur)
            res.json(recur);
        })
});

const port = process.env.port || 1984;

app.listen(port, function () {
    console.log(`App is running on ${port}`);
});