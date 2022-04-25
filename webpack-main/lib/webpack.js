/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/

"use strict";

const util = require("util");
const webpackOptionsSchemaCheck = require("../schemas/WebpackOptions.check.js");
const webpackOptionsSchema = require("../schemas/WebpackOptions.json");
const Compiler = require("./Compiler");
const MultiCompiler = require("./MultiCompiler");
const WebpackOptionsApply = require("./WebpackOptionsApply");
const {
  applyWebpackOptionsDefaults,
  applyWebpackOptionsBaseDefaults
} = require("./config/defaults");
const { getNormalizedWebpackOptions } = require("./config/normalization");
const NodeEnvironmentPlugin = require("./node/NodeEnvironmentPlugin");
const memoize = require("./util/memoize");

/** @typedef {import("../declarations/WebpackOptions").WebpackOptions} WebpackOptions */
/** @typedef {import("./Compiler").WatchOptions} WatchOptions */
/** @typedef {import("./MultiCompiler").MultiCompilerOptions} MultiCompilerOptions */
/** @typedef {import("./MultiStats")} MultiStats */
/** @typedef {import("./Stats")} Stats */

const getValidateSchema = memoize(() => require("./validateSchema"));

/**
 * @template T
 * @callback Callback
 * @param {Error=} err
 * @param {T=} stats
 * @returns {void}
 */

/**
 * @param {ReadonlyArray<WebpackOptions>} childOptions options array
 * @param {MultiCompilerOptions} options options
 * @returns {MultiCompiler} a multi-compiler
 */
const createMultiCompiler = (childOptions, options) => {
  const compilers = childOptions.map(options => createCompiler(options));
  const compiler = new MultiCompiler(compilers, options);
  for (const childCompiler of compilers) {
    if (childCompiler.options.dependencies) {
      compiler.setDependencies(
        childCompiler,
        childCompiler.options.dependencies
      );
    }
  }
  return compiler;
};

/**
 * @param {WebpackOptions} rawOptions options object
 * @returns {Compiler} a compiler
 */
// 创建 compiler
const createCompiler = rawOptions => {
  //  1.格式化传进来的参数(如output,plugins),给赋值一些默认的配置格式,防止之后报错
  //  getNormalizedWebpackOptions + applyWebpackOptionsBaseDefaults 合并出最终的 webpack 配置
  const options = getNormalizedWebpackOptions(rawOptions);
  applyWebpackOptionsBaseDefaults(options);
  //  2.实例化Compiler得到一个compiler对象,并将option(格式化后的webapck配置) 传入compiler
  const compiler = new Compiler(options.context, options);
  //  3.将NodeEnvironmentPlugin插入到compiler实例中
  //  NodeEnvironmentPlugin 插件主要是文件系统挂载到compiler对象上
  //  如 infrastructureLogger(log插件)、inputFileSystem(文件输入插件)、outputFileSystem(文件输出插件)、watchFileSystem(监听文件输入插件)
  new NodeEnvironmentPlugin({
    infrastructureLogging: options.infrastructureLogging
  }).apply(compiler);

  //  4.注册所有的插件,所以在编译前插件就已注册,比loader先执行
  if (Array.isArray(options.plugins)) {
    for (const plugin of options.plugins) {
      //  5.插件有两种形式,一种是函数,一种是对象
      //  如果是函数,则把compiler当参数,并call调用这个函数
      if (typeof plugin === "function") {
        plugin.call(compiler, compiler);
      } else {
        //  如果插件是对象形式,那么插件本身就要实现一个apply的函数,并把compiler当做参数且调用apply函数
        //  插件形式类似于 class MyPlugin { apply(compiler) { } } 
        plugin.apply(compiler);
      }
    }
  }
  //  6.调用 compiler 身上的两个勾子 environment、afterEnvironment
  applyWebpackOptionsDefaults(options);
  compiler.hooks.environment.call();
  compiler.hooks.afterEnvironment.call();

  //  7.WebpackOptionsApply().process 主要用来处理 config 文件中除了 plugins 的其他属性
  //  如 entry,output,resolve,resolveLoader,externals,devtool,performance,stats,cache,watchOptions,context,target,recordsInputPath,recordsOutputPath,recordsPath,
  //  这个东西非常关键,会将配置的一些属性转换成插件注入到webnpack中
  new WebpackOptionsApply().process(options, compiler);
  //  8.调用初始化 initialize 勾子
  compiler.hooks.initialize.call();
  //  9.返回compiler实例
  return compiler;
};

/**
 * @callback WebpackFunctionSingle
 * @param {WebpackOptions} options options object
 * @param {Callback<Stats>=} callback callback
 * @returns {Compiler} the compiler object
 */

/**
 * @callback WebpackFunctionMulti
 * @param {ReadonlyArray<WebpackOptions> & MultiCompilerOptions} options options objects
 * @param {Callback<MultiStats>=} callback callback
 * @returns {MultiCompiler} the multi compiler object
 */

const asArray = options =>
  Array.isArray(options) ? Array.from(options) : [options];

const webpack = /** @type {WebpackFunctionSingle & WebpackFunctionMulti} */ (
  /**
   * @param {WebpackOptions | (ReadonlyArray<WebpackOptions> & MultiCompilerOptions)} options options
   * @param {Callback<Stats> & Callback<MultiStats>=} callback callback
   * @returns {Compiler | MultiCompiler}
   */
  (options, callback) => {
    const create = () => {
      //  检验传入的配置文件【webpack.config.js】是否符合 webpack 内部定义的 webpackOptionsSchema 范式
      if (!asArray(options).every(webpackOptionsSchemaCheck)) {
        getValidateSchema()(webpackOptionsSchema, options);
        util.deprecate(
          () => { },
          "webpack bug: Pre-compiled schema reports error while real schema is happy. This has performance drawbacks.",
          "DEP_WEBPACK_PRE_COMPILED_SCHEMA_INVALID"
        )();
      }
      /** @type {MultiCompiler|Compiler} */
      //  1️⃣ 定义 compiler、watch、watchOptions
      let compiler;
      let watch = false;
      /** @type {WatchOptions|WatchOptions[]} */
      let watchOptions;
      //  如果传入的webpack配置文件是一个数组，则创建一个多线程编译器
      if (Array.isArray(options)) {
        /** @type {MultiCompiler} */
        compiler = createMultiCompiler(
          options,
					/** @type {MultiCompilerOptions} */(options)
        );
        watch = options.some(options => options.watch);
        watchOptions = options.map(options => options.watchOptions || {});
      } else {
        const webpackOptions = /** @type {WebpackOptions} */ (options);
        /** @type {Compiler} */
        //  2️⃣ 定义 通过createCompiler创建一个compiler
        compiler = createCompiler(webpackOptions);
        //  3️⃣ 拿到webpack.config.js中的watch,watchOptions判断是否需要监听
        watch = webpackOptions.watch;
        watchOptions = webpackOptions.watchOptions || {};
      }
      return { compiler, watch, watchOptions };
    };
    /**
     * 判断在执行 webapck 函数的时候,有没有传入 callback 回调函数
     * 无论是否传入 callback 回调函数,都会返回一个 compiler 对象
     * 差别是:如果传入了 callback, 会调用compiler.run,没有传入则需要手动调用compiler.run
     */
    if (callback) {
      try {
        const { compiler, watch, watchOptions } = create();
        if (watch) {
          //  config 文件有没有配置 watch,如果有,会监听文件改变,重新编译
          compiler.watch(watchOptions, callback);
        } else {
          compiler.run((err, stats) => {
            compiler.close(err2 => {
              callback(err || err2, stats);
            });
          });
        }
        return compiler;
      } catch (err) {
        process.nextTick(() => callback(err));
        return null;
      }
    } else {
      //  没有传入回调函数的情况
      //  执行 create 函数,拿到 compiler,watch
      const { compiler, watch } = create();
      if (watch) {
        util.deprecate(
          () => { },
          "A 'callback' argument needs to be provided to the 'webpack(options, callback)' function when the 'watch' option is set. There is no way to handle the 'watch' option without a callback.",
          "DEP_WEBPACK_WATCH_WITHOUT_CALLBACK"
        )();
      }
      return compiler;
    }
  }
);

module.exports = webpack;
