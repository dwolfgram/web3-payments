const EthereumjsUtil = require('ethereumjs-util')
const TEN = require('./numbers').TEN
const toBigNumber = require('./numbers').toBigNumber

const toTxFee = (gasLimit, gasPrice) => {
  gasLimit = toBigNumber(gasLimit)
  gasPrice = toBigNumber(gasPrice)
  const power = TEN.pow(18)
  return gasLimit.times(gasPrice).div(power)
}

const toHex = (value) => {
  value = toBigNumber(value)
  return addHexPrefix(value.toString(16))
}

const toChecksumAddress = (address) => {
  return EthereumjsUtil.toChecksumAddress(address)
}

const addHexPrefix = (hex) => {
  if (typeof hex !== 'string') hex = String(hex)
  if (hex.startsWith('0x')) return hex
  return `0x${hex}`
}

module.exports = {
  toTxFee,
  toHex,
  toChecksumAddress,
  addHexPrefix
}