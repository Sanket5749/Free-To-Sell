require("dotenv").config();

const express = require("express");
const app = express();
const mongoose = require("mongoose");
const path = require("path");
const port = 8080;
const engine = require("ejs-mate");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const flash = require("connect-flash");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("./models/user");
const methodOverride = require("method-override");
const bodyParser = require("body-parser");
const Listing = require("./models/listing");
const { read } = require("fs");
const Review = require("./models/review.js");
const multer = require("multer");
const { storage } = require("./cloudConfig.js");
const upload = multer({ storage });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(methodOverride("_method"));

main()
  .then(() => {
    console.log("Connected to MongoDB");
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
  });

async function main() {
  await mongoose.connect(process.env.MONGO_URL);
}

app.set("view engine", "ejs");
app.engine("ejs", engine);
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const store = MongoStore.create({
  mongoUrl: process.env.MONGO_URL,
  crypto: {
    secret: process.env.SECRET,
  },
  touchAfter: 24 * 3600,
});

const sessionOptions = {
  store,
  secret: process.env.SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
  },
};

app.use(session(sessionOptions));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.CALL_BACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ googleId: profile.id });

        if (!user) {
          user = new User({
            googleId: profile.id,
            username: profile.displayName,
            email: profile.emails[0].value,
          });
          await user.save();
        }

        done(null, user);
      } catch (err) {
        done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

app.use((req, res, next) => {
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.path = req.path;
  res.locals.currentUser = req.user;
  next();
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

const isLoggedIn = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  req.flash("error", "You must be logged in!");
  res.redirect("/login");
};

app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login",
    failureFlash: true,
  }),
  (req, res) => {
    req.flash("success", "Successfully logged in with Google!");
    res.redirect("/");
  }
);

app.get("/signup", (req, res) => {
  res.render("signup.ejs");
});

app.post("/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const newUser = new User({ username, email });

    const registeredUser = await User.register(newUser, password);

    req.flash("success", "Signup successful! Please log in.");
    res.redirect("/");
  } catch (err) {
    console.error(err);
    req.flash("error", "Signup failed. Please try again.");
    res.redirect("/signup");
  }
});

app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.post(
  "/login",
  passport.authenticate("local", {
    failureRedirect: "/login",
    failureFlash: true,
  }),
  (req, res) => {
    req.flash("success", "You are Successfully Logged In");
    res.redirect("/");
  }
);
app.post("/logout", isLoggedIn, (req, res) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    req.flash("success", "You have been logged out!");
    res.redirect("/");
  });
});

app.get("/", isLoggedIn,async (req, res) => {
  const pic = req.user.username.charAt(0);
  const user = req.user.username;
  const allListing = await Listing.find({});
  res.render("index.ejs", { allListing, pic, user });
});
app.get("/listings/new", (req, res) => {
  res.render("new.ejs");
});
app.get("/listings/:id", async (req, res) => {
  let { id } = req.params;
  const listing = await Listing.findById(id)
    .populate({
      path: "reviews",
      populate: {
        path: "author",
      },
    })
    .populate("owner");
  const pay = process.env.RAZORPAY_KEY_ID;  
  res.render("show.ejs", { listing, pay });
});
app.post(
  "/",
  isLoggedIn,
  upload.single("listing[image]"),
  async (req, res) => {
    try {
      let url = req.file.path;
      let filename = req.file.filename;
      const newListing = new Listing(req.body.listing);
      newListing.owner = req.user._id;
      newListing.image = { url, filename };
      await newListing.save();
      req.flash("success", "New Product Created!");
      res.redirect("/listings");
    } catch (err) {
      req.flash("error", "Could not create Product. Please try again.");
      res.redirect("/listings/new");
    }
  }
);
app.get("/listings/:id/edit", isLoggedIn, async (req, res) => {
  let { id } = req.params;
  const listing = await Listing.findById(id);
  res.render("edit.ejs", { listing });
});
app.put(
  "/listings/:id",
  isLoggedIn,
  upload.single("listing[image]"),
  async (req, res) => {
    const { id } = req.params;
    let listing = await Listing.findById(id);
    if(!listing.owner._id.equals(res.locals.currentUser._id)){
      req.flash("error", "You don't have Permission to Edit.");
      return res.redirect(`/listings/${id}`);
    }
    try {
      const listing = await Listing.findById(id);
      if (!listing) {
        req.flash("error", "Product not found!");
        return res.redirect("/");
      }
      const updatedData = { ...req.body.listing };
      if (req.file) {
        const url = req.file.path;
        const filename = req.file.filename;
        updatedData.image = { url, filename };
        if (listing.image && listing.image.filename) {
          await cloudinary.uploader.destroy(listing.image.filename);
        }
      }
      await Listing.findByIdAndUpdate(id, updatedData);
      req.flash("success", "Product updated successfully!");
      res.redirect(`/listings/${id}`);
    } catch (err) {
      req.flash("error", "Could not update the Product. Please try again.");
      res.redirect(`/listings/${id}`);
    }
  }
);
app.delete("/listings/:id", isLoggedIn, async (req, res) => {
  let { id } = req.params;
  let listing = await Listing.findById(id);
  if(!listing.owner._id.equals(res.locals.currentUser._id)){
    req.flash("error", "You don't have Permission to Delete.");
    return res.redirect(`/listings/${id}`);
  }
  let deletedListing = await Listing.findByIdAndDelete(id);
  res.redirect("/");
});

app.post("/listings/:id/reviews", isLoggedIn, async (req, res) => {
  let { id } = req.params;
  let listing = await Listing.findById(req.params.id);
  let newReview = new Review(req.body.review);
  newReview.author = req.user._id;
  console.log(newReview.author);
  listing.reviews.push(newReview);
  await newReview.save();
  await listing.save();
  res.redirect(`/listings/${id}`);
});
app.delete("/listings/:id/reviews/:reviewId", isLoggedIn, async (req, res) => {
  let { id, reviewId } = req.params;
  let review = await Review.findById(reviewId);
  if (!review.author.equals(res.locals.currentUser._id)) {
    req.flash("error", "You are not the author of this review.");
    return res.redirect(`/listings/${id}`);
  } else {
    await Listing.findByIdAndUpdate(id, { $pull: { reviews: reviewId } });
    await Review.findByIdAndDelete(reviewId);
    res.redirect(`/listings/${id}`);
  }
});
app.get("/listings/:id/cart/", isLoggedIn,async (req, res) => {
  try {
    const { id } = req.params;
    const listing = await Listing.findById(id);

    if (!listing) {
      return res.status(404).send("Listing not found");
    }

    const listings = [listing];
    res.render("cart.ejs", { listings });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).send("Internal Server Error");
  }
});