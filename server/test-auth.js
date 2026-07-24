const { safeCompare } = require('./utils/helpers.js');
require('dotenv').config();

const passwordInput = ')aYNN.B,j{=F%Cj7k8pVT=y=';
const adminPassEnv = process.env.ADMIN_PASSWORD;

console.log("input len:", passwordInput.length, "env len:", adminPassEnv ? adminPassEnv.length : 'undefined');
console.log("safeCompare:", safeCompare(passwordInput, adminPassEnv));
