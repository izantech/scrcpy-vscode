//@ts-check
'use strict';

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const fs = require('fs');

// Check if ios-helper binary exists (only on macOS)
const iosHelperPath = path.resolve(__dirname, 'native/ios-helper/.build/release/ios-helper');
const iosHelperExists = fs.existsSync(iosHelperPath);

class EnsureExecutablePlugin {
  /**
   * @param {string} relativePath
   */
  constructor(relativePath) {
    this.relativePath = relativePath;
  }

  /**
   * @param {import('webpack').Compiler} compiler
   */
  apply(compiler) {
    compiler.hooks.afterEmit.tap('EnsureExecutablePlugin', () => {
      try {
        const outputPath = compiler.options.output?.path;
        if (!outputPath) {
          return;
        }
        const targetPath = path.resolve(outputPath, this.relativePath);
        if (fs.existsSync(targetPath)) {
          fs.chmodSync(targetPath, 0o755);
        }
      } catch {
        // Best-effort: permissions may be read-only in some environments.
      }
    });
  }
}

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  target: 'node',
  mode: 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    vscode: 'commonjs vscode',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader' }],
      },
    ],
  },
  plugins: iosHelperExists
    ? [
        new CopyPlugin({
          patterns: [
            {
              from: 'native/ios-helper/.build/release/ios-helper',
              to: 'ios-helper',
            },
          ],
        }),
        new EnsureExecutablePlugin('ios-helper/ios-helper'),
      ]
    : [],
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: 'log',
  },
};

/** @type {import('webpack').Configuration} */
const webviewConfig = {
  target: 'web',
  mode: 'none',
  entry: './src/webview/main.ts',
  output: {
    path: path.resolve(__dirname, 'dist', 'webview'),
    filename: 'main.js',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: 'tsconfig.webview.json',
            },
          },
        ],
      },
    ],
  },
  devtool: 'nosources-source-map',
};

module.exports = [extensionConfig, webviewConfig];
