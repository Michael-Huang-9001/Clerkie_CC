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

function recurring_txs() {

}

app.get('/', (req, res) => {
    res.json({ 'msg': 'Get recurrin transactions' })
});

app.post('/', (req, res) => {
    //console.log(req.body);
    Transaction.insertMany(req.body)
        .then((tx) => {
            //res.json(tx);
            res.json({ transactions: tx });
        }).catch((error) => {
            res.json({ 'msg': error.errmsg });
        });
});

const port = process.env.port || 1984;

app.listen(port, function () {
    console.log(`App is running on ${port}`);
});