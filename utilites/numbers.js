const BigNumber = require('bignumber.js')

const ZERO = new BigNumber(0)
const ONE = new BigNumber(1)
const TEN = new BigNumber(10)
const HUNDRED = new BigNumber(100)
const THOUSAND = new BigNumber(1000)

const toBigNumber = (value = 0) => {
  if (value === '0x') { value = 0 }
  if (!(value instanceof BigNumber)) {
    try {
      const bn = new BigNumber(String(value))
      return bn
    } catch (e) {
      return ZERO
    }
  }
  return value
}

const isBigNumber = (value) => {
  return value instanceof BigNumber
}

const toNumber = (value = 0) => {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    value = toBigNumber(value)
  }
  if (value instanceof BigNumber) {
    return value.toNumber()
  }
  return 0
}

const toMainDenomination = (value, decimals) => {
  value = toBigNumber(value)
  const power = TEN.pow(decimals)
  return value.div(power)
}

const toSmallestDenomination = (value, decimals) => {
  value = toBigNumber(value)
  const power = TEN.pow(decimals)
  return value.times(power)
}

const toPrecision = (amount, decimals) => {
  amount = toBigNumber(amount)
  const power = TEN.pow(decimals)
  return amount.times(power).round().div(power)
}

const toUnit = (amount, rate, decimals, rateFrom) => {
  amount = toBigNumber(amount)
  rate = toBigNumber(rate)
  const conversion = rateFrom ? amount.div(rate) : amount.times(rate)
  return toPrecision(conversion, decimals)
}

const toPercentage = (amount, total) => {
  amount = toBigNumber(amount)
  total = toBigNumber(total)
  return amount.div(total).times(100).round(2)
}

module.exports = {
  ZERO,
  ONE,
  TEN,
  HUNDRED,
  THOUSAND,
  toBigNumber,
  isBigNumber,
  toNumber,
  toMainDenomination,
  toSmallestDenomination,
  toPrecision,
  toUnit,
  toPercentage
}
