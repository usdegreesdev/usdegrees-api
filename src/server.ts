import "dotenv/config";
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

// import jwt from "jsonwebtoken";
import { app } from "./app";

import { verifyToken } from "./middleware/auth";
import statesRoute from "./routes/states";
import credentialsRoute from "./routes/credentials";
import coursesRoute from "./routes/courses";
import searchRoute from "./routes/search";
import overviewDetails from "./routes/overviewDetails";
import outcomes from "./routes/outcomes";
import tuitionRoute from "./routes/tuition";
import campusRoute from "./routes/campus";
import collegeSummaryRoute from "./routes/collegeSummary";
import programsRoute from "./routes/programs";
import schoolLevelSearchRouter from "./routes/schoollevelsearch";
import collegesRoute from "./routes/colleges";
import compareRoute from "./routes/compare";
import userRoute from "./routes/user";
import authRoute from "./routes/auth";
import profileRoute, { accountRouter } from "./routes/profile";
import savedCollegesRoute from "./routes/savedColleges";
import degreeLevelsRoute from "./routes/degreeLevels";
import reportRoute from "./routes/report";
import athleticsRoute from "./routes/athletics";
import popularCategoriesRoute from "./routes/popularCategories";
import analyticsRoute from "./routes/analytics";
import sitemapRoute from "./routes/sitemap";
import catalogRoute from "./routes/catalog";
const PORT = process.env.PORT || 8000;
console.log("SERVER.TS EXECUTED");

app.use("/states", statesRoute);
app.use("/credentials", credentialsRoute);
app.use("/courses", coursesRoute);
app.use("/search", searchRoute);
app.use("/overview", overviewDetails);
app.use("/outcomes", outcomes);
app.use("/tuition", tuitionRoute);
app.use("/campus", campusRoute);
app.use("/college-summary", collegeSummaryRoute);
app.use("/programs", programsRoute);
app.use("/schools", schoolLevelSearchRouter);
app.use("/colleges", collegesRoute);
app.use("/compare", compareRoute);
app.use("/user", userRoute);
app.use("/auth", authRoute);
app.use("/profile", profileRoute);
app.use("/account", accountRouter);
app.use("/saved-colleges", savedCollegesRoute);
app.use("/degree-levels", degreeLevelsRoute);
app.use("/report", reportRoute);
app.use("/athletics", athleticsRoute);
app.use("/popular-categories", popularCategoriesRoute);
app.use("/analytics", analyticsRoute);
app.use("/sitemap", sitemapRoute);
app.use("/catalog", catalogRoute);
app.get("/", (req, res) =>
  res.json({ status: "ok", message: "API is running" }),
);
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
