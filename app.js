const express = require('express');
const bodyparser = require('body-parser');
const mongoose = require('mongoose');
const db_config = require('./config/db');

let app = express();
app.use(bodyparser.json());

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

async function upsert(body) {
    // This assumes the batch of upserts are all from the same user_id
    let user_id = '';
    if (body.length) {
        user_id = body[0].user_id;
    }

    for (let tx of body) {
        // Should validate each field of a tx for empty/nulls?
        Transaction.findOneAndUpdate({ trans_id: tx.trans_id }, tx, { upsert: true })
            .catch((error) => {
                if (error) {
                    console.log(error);
                }
            });
    }
    return user_id;
}

async function recur() {
    /*
    - name: Exact name of the most recent transaction (String)
    - user_id: Same as above (String)
    - next_amt: Estimated amount of the next transaction (Number)
    - next_date: Estimated date of the next transaction (Date)
    - transactions: All transactions that are part of this recurring transaction group (Array of transactions)
    */

    // Temp hardcodes
    let list = [];
    let result = {};
    result.name = "Netflix";
    result.user_id = "5q6ppfjopiuky3-1";
    result.next_amt = 45;
    result.next_date = new Date().toISOString();
    result.transactions = await Transaction.find({ name: "Netflix" });

    list.push(result);
    return [{ "name": "Netflix", "user_id": "5q6py2jopk62cg-1", "next_date": "2018-12-18T09:50:25.160Z", "next_amt": 13.99, "transactions": [{ "trans_id": "5q6py2jopk63k8::5q6py2jopk63kb", "user_id": "5q6py2jopk62cg-1", "name": "Netflix", "amount": 13.99, "date": "2018-09-18T08:50:25.160Z" }, { "trans_id": "5q6py2jopk63k8::5q6py2jopk63ka", "user_id": "5q6py2jopk62cg-1", "name": "Netflix", "amount": 13.99, "date": "2018-10-18T08:50:25.160Z" }, { "trans_id": "5q6py2jopk63k8::5q6py2jopk63k9", "user_id": "5q6py2jopk62cg-1", "name": "Netflix", "amount": 13.99, "date": "2018-11-18T09:50:25.160Z" }] }];
}

app.get('/', (req, res) => {
    recur().then((r) => {
        //console.log(r);
        res.send(r);
    })
});

app.post('/', (req, res) => {
    //console.log(req.body);
    upsert(req.body).then((user_id) => {
        return recur(user_id);
    }).then((recur) => {
        res.send(recur);
    })
});

const port = process.env.port || 1984;

app.listen(port, function () {
    console.log(`App is running on ${port}`);
});