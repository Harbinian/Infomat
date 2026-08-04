'use strict';

const readline = require('readline');
const { hashPassword } = require('../lib/auth');

if (!process.stdin.isTTY) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    const password = input.replace(/\r?\n$/, '');
    if (!password) {
      console.error('未收到密码。');
      process.exitCode = 1;
      return;
    }
    console.log(hashPassword(password));
  });
} else {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question('请输入需要生成哈希的登录密码：', password => {
    rl.close();
    if (!password) {
      console.error('密码不能为空。');
      process.exitCode = 1;
      return;
    }
    console.log(hashPassword(password));
  });
}
