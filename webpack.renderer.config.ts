import type { Configuration } from "webpack";

export const rendererConfig: Configuration = {
  devtool: "source-map",
  module: {
    rules: require("./webpack.rules")
  },
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css", ".json"]
  }
};

