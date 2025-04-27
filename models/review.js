const mongoose = require("mongoose");
const User = require("./user.js");

const reviewSchema = new mongoose.Schema({
  comment: String,
  rating: {
    type: Number,
    max: 5,
    min: 1,
  },
  createdAT: {
    type: Date,
    default: Date.now(),
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
});

module.exports = mongoose.model("Review", reviewSchema);
