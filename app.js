const express = require("express");
const bodyparser = require("body-parser");
const mongoose = require("mongoose");
const db_config = require("./config/db");

const TIME_DELTA = 0.2; // 20% delta allowed
const AMOUNT_DELTA = 0.2; // 20% delta multiplier allowed

// App setup
let app = express();
app.use(bodyparser.json());

// DB setup
let Transaction = require("./models/transactions");

mongoose.connect(
  db_config.url,
  { useNewUrlParser: true, connectTimeoutMS: 10000, socketTimeoutMS: 10000 },
  err => {
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
 * Assumes there's a number in the last phrase if it has something after the company name
 */
async function getTxGroup(tx) {
  let company_name = tx.name;
  if (company_name.length > 1) {
    let last_space_index = company_name.lastIndexOf(" ");
    if (/\d/.test(company_name.substring(last_space_index))) {
      // Substring after final space ch has numbers
      company_name = company_name.substring(0, last_space_index);
    }
  }
  return company_name;
}

/**
 *  Upserts post data to DB
 */
async function upsert(body) {
  // This assumes the batch of upserts are all from the same user_id
  // An auth filter can take care of user ID authentication and further filtering

  /*
    - trans_id: Unique identifier for the given transaction (String)
    - user_id: Unique identifier of the user sending the request (String)
    - name: Name of the transaction (String)
    - amount: Amount of the transaction in dollars (Number)
    - date: Date the transaction posted to the account (Date)
    */

  for (let tx of body) {
    // Should validate each field of a tx for empty/nulls?
    tx.company = await getTxGroup(tx);
    await Transaction.findOneAndUpdate({ trans_id: tx.trans_id }, tx, {
      upsert: true
    }).catch(error => {
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
  let table = {};
  let results = await Transaction.find({})
    .sort({ company: 1, date: 1, name: 1 })
    .lean(); // Oldest date first

  for (let result of results) {
    if (table[result.company]) {
      // if tx group already in table
      await table[result.company].push(result);
    } else {
      table[result.company] = await [result];
    }
  }

  let result = [];

  for (let key in table) {
    let predicted_tx = await calculateRecurrence(table[key]);
    result.push(predicted_tx);
  }

  return result;
}

/**
 * Performs 3 checks:
 * 1. Finds all intervals between dates and track how many times they occur
 * 2. Find the most recurring interval
 * 3. Find all txs that match the time interval
 *
 * Might be incredible inefficient to do this for all companies/tx groups
 * @param {*} table The table keys are the tx_groups/companies
 */
function calculateRecurrence(tx_group) {
  let possible_recurring_times = {};

  // This nested for loop gets all of the time increments found within the company
  for (let i = 0; i < tx_group.length - 1; i++) {
    let tx = tx_group[i];
    for (let j = i + 1; j < tx_group.length; j++) {
      let next_tx = tx_group[j];
      let days_diff = dateDifference(tx.date, next_tx.date); // Calcs difference of dates in days
      //console.log(`${tx.date.toISOString()} vs ${next_tx.date.toISOString()} : ${days_diff}`);

      // Adds the date increment if the amounts are within +- 20%
      if (amountDifference(tx.amount, next_tx.amount)) {
        let estimated_interval = Math.round(days_diff);

        // Adjust for months with 31 days for more roundness, may not be good in practice
        // if (estimated_interval == 31) {
        //     estimated_interval = 30;
        // }

        // Increment interval occurances
        if (possible_recurring_times[estimated_interval]) {
          possible_recurring_times[estimated_interval] += 1;
        } else {
          possible_recurring_times[estimated_interval] = 1;
        }
      }
    }
  }

  // Grabs the interval that appears the most often
  let recurring_interval = 0;
  let most_occurances = 0;
  for (let interval in possible_recurring_times) {
    //console.log(`${interval} days detected ${possible_recurring_times[interval]} times`)
    if (possible_recurring_times[interval] > most_occurances) {
      most_occurances = possible_recurring_times[interval];
      recurring_interval = interval;
    }
  }

  //console.log(`Most recurring interval: ${recurring_interval} days`);

  if (!recurring_interval && !most_occurances) {
    // No recurrences detected
    return {};
  }

  let recurring = [];

  // Find dates with interval that matches the most recurring interval
  for (let i = 0; i < tx_group.length - 1; i++) {
    let tx = tx_group[i];
    for (let j = i + 1; j < tx_group.length; j++) {
      let next_tx = tx_group[j];
      let days_diff = dateDifference(tx.date, next_tx.date);

      let time_max = recurring_interval * (1 + TIME_DELTA); // Interval + 20%
      let time_min = recurring_interval * (1 - TIME_DELTA); // Interval - 20%

      //   console.log(`i: ${i} j: ${j}`);

      // Amount within tolerance and time interval within tolerance
      if (
        amountDifference(tx.amount, next_tx.amount) &&
        days_diff > time_min &&
        days_diff < time_max
      ) {
        tx_group[i].is_recurring = true;
        recurring.push(tx);
        if (j == tx_group.length - 1) {
          // next is the last element and is recurring
          tx_group[j].is_recurring = true;
          recurring.push(next_tx);
        }

        i = j - 1;
        break;
      }
    }
  }

  //console.log(recurring);

  // To save further work, maybe we can upsert the txs that have been identified as recurring
  // to avoid calculating its recurrence in the future.

  /*
    - name: Exact name of the most recent transaction (String)
    - user_id: Same as above (String)
    - next_amt: Estimated amount of the next transaction (Number)
    - next_date: Estimated date of the next transaction (Date)
    - transactions: All transactions that are part of this recurring transaction group (Array of transactions)
    */

  let predict_next_tx = {};
  if (recurring.length) {
    let most_recent_tx = recurring[recurring.length - 1];
    predict_next_tx.name = most_recent_tx.name;
    predict_next_tx.user_id = most_recent_tx.user_id;

    // Average the recurring tx amounts instead
    let next_amt = 0;
    for (let tx of recurring) {
      next_amt += tx.amount;
    }
    next_amt /= recurring.length;
    predict_next_tx.next_amt = next_amt;

    // predict_next_tx.next_amt = most_recent_tx.amount; // Assume same amount as previous one

    let next_date = new Date(most_recent_tx.date);
    next_date.setTime(next_date.getTime() + 86400000 * recurring_interval);
    predict_next_tx.next_date = next_date;

    predict_next_tx.transactions = recurring;
  }
  return predict_next_tx;
}

/**
 * Helper function that gets the number of days between timestamps
 */
function dateDifference(date_a, date_b) {
  return Math.abs(date_a - date_b) / 86400000; // 86400000 is 1 day in milliseconds
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
app.get("/", (req, res) => {
  req.setTimeout(10000);
  recur().then(result => {
    //console.log(JSON.stringify(r));
    res.json(result);
  });
});

/**
 * Root POST path, upserts txs and gets recurring txs
 */
app.post("/", (req, res) => {
  req.setTimeout(10000);
  upsert(req.body)
    .then(() => {
      return recur();
    })
    .then(results => {
      //console.log(JSON.stringify(results));
      res.json(results);
    });
});

const port = process.env.port || 1984;

app.listen(port, function() {
  console.log(`App is running on ${port}`);
});
