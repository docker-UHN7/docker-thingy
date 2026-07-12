import type { Configuration } from "webpack";

export const mainConfig: Configuration = {
  entry: "./src/main.ts",
  externals: {
    dockerode: "commonjs2 dockerode"
  },
  module: {
    rules: require("./webpack.rules")
  },
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css", ".json"]
  }
};

