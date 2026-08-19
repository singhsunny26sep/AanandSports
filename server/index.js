require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const ngrok = require("ngrok");
const fileUpload = require("express-fileupload");

const { mongoDb } = require("./database/mongoDb");
const { errorHandler } = require("./middlewares");
const { throwError } = require("./utils");
const allRoutes = require("./routes");

const app = express();
const port = process.env.PORT || 8080;

app.use(fileUpload({ useTempFiles: true, tempFileDir: "/tmp/" }));
app.use(express.json());
app.use(cors());
app.use(morgan("dev"));
app.use("/aanand-sports/", allRoutes);
app.get("/", async (req, res) => {
  res.send("Welcome to Aanand Sports🚀");
});
app.use((req, res, next) => {
  throwError(404, "Invalid API");
});
app.use(errorHandler);

mongoDb();

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(port, async () => {
    console.log(`✅ Aanand Sports Server running on http://localhost:${port}`);
    if (process.env.ENABLE_NGROK === "true") {
      const url = await ngrok.connect({
        addr: port,
        authtoken: process.env.NGROK_AUTH_TOKEN,
      });
      console.log(`Public URL: ${url}`);
    }
  });
}
