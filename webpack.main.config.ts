import type { Configuration } from "webpack";

export const mainConfig: Configuration = {
  entry: "./src/main.ts",
  module: {
    rules: require("./webpack.rules")
  },
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css", ".json"]
  }
};

