# Clerkie Backend Coding Challenge

To run this program, you'll need to install any dependencies it may need.
You'll also need MongoDB and Node.js installed.

There is a POST endpoint and a GET at the root "/".

## The server
For POSTing, the server takes a list of transactions and upserts them into the database based on transaction_id.
Then it calculates any recurring transactions based on the most recurring date increments, and accepts any transactions
whose dates apart are within 20% of the identified most recurring increment.

For both POST and GET, it predicts the next transaction based on the most recent recurring transaction, and returns the prediction
as well as a list of its past recurring transactions.

The amount tolerance for accepting recurrences can be changed as it is a constant. For better results, reduce the amount tolerance, as its default is 20%.

## Upsert
The transaction upserts are determined by the transaction ID.
Transactions are also grouped by the company of the transaction.

Grouping by company assumes the transaction name is something like:

[company_name] [company_name] ... [string with numbers]

where the string of numbers is appended to the company name to distinguish unique transactions for that company.

## Checking recurrence
To check recurrence for a group of transactions, first calculate the time interval that appears the most often.
Then using that most often recurring time interval, filter out any transactions that have similar time intervals.
Then using the same most often recurring time interval, calculate the next recurring transaction using the last recurring date found in the list of trasnactions.
