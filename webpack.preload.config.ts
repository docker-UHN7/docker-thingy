import type { Configuration } from "webpack";

export const preloadConfig: Configuration = {
  module: {
    rules: require("./webpack.rules")
  },
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css", ".json"]
  },
  devtool: "source-map"
};