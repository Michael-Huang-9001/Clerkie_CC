const mongoose = require('mongoose');

let schema = new mongoose.Schema({
    trans_id: {
        type: String,
        //unique: true,
        required: true
    },
    user_id: {
        type: String,
        required: true
    },
    name: {
        type: String
    },
    amount: {
        type: Number
    },
    date: {
        type: Date
    }
});

let Transaction = mongoose.model("Transaction", schema);

module.exports = Transaction;