const webpack = require('../webpack-main/lib/webpack');
const config = require('./webpack.config');

//  执行webpack函数,有传回调函数
// const compiler = webpack(config, (err, status) => {
//   if (err) {
//     console.log(errr)
//   }
// });



//  执行webpack,不传回调函数
const compiler = webpack(config);
//  手动调用run方法
compiler.run((err, status) => {
  if (err) {
    console.log(err)
  }
})

