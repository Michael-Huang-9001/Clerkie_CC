const mongoose = require('mongoose');

let schema = new mongoose.Schema({
    trans_id: {
        type: String,
        // Need unique for trans_id upsert
        unique: true,
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
    },
    company: {
        type: String
    },
    // is_recurring: {
    //     type: Boolean,
    //     default: false
    // }
});

let Transaction = mongoose.model("Transaction", schema);

module.exports = Transaction;