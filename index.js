const web3 = require('web3')
const axios = require('axios').default
const Tx = require('ethereumjs-tx')
const ethUtil = require('ethereumjs-util')
const getAddressBalances = require('eth-balance-checker/lib/web3').getAddressBalances
const pad = require('pad-left')
const toHex = require('./utilites/convert').toHex
const toTxFee = require('./utilites/convert').toTxFee
const toBigNumber = require('./utilites/numbers').toBigNumber
const toNumber = require('./utilites/numbers').toNumber
const toSmallestDenomination = require('./utilites/numbers').toSmallestDenomination
const toMainDenomination = require('./utilites/numbers').toMainDenomination
const ZERO = require('./utilites/numbers').ZERO
const TEN = require('./utilites/numbers').TEN

const DEFAULT_GAS_PRICE = 21e9 // 21 Gwei
const DEFAULT_GAS_LIMIT_ETH = toBigNumber(21000)
const DEFAULT_GAS_LIMIT_TOKEN = toBigNumber(100000)
const MIN_GAS_LIMIT_ETH = DEFAULT_GAS_LIMIT_ETH
const MIN_GAS_LIMIT_TOKEN = DEFAULT_GAS_LIMIT_TOKEN

function Web3Payments (options) {
  if (!(this instanceof Web3Payments)) return new Web3Payments(options)
  let self = this
  self.options = Object.assign({}, options || {})
  if (!self.options.web3Provider) {
    if (!self.options.network || (self.options.network === 'mainnet')) {
      self.options.web3Provider = 'https://mainnet.infura.io/v3/770c3b3eca7547eabd02f4500f9618f5'
    } else if (self.options.network === 'testnet') {
      self.options.web3Provider = 'https://ropsten.infura.io/v3/770c3b3eca7547eabd02f4500f9618f5'
    } else {
      return new Error('Invalid network provided ' + self.options.network)
    }
    if (!self.options.explorerUrl) {
      self.options.explorerUrl = 'http://api.etherscan.io/api'
    }
    console.log('WARN: Using default eth provider. It is highly suggested you set one yourself!', self.options.web3Provider)
    self.options.web3 = new web3(new web3.providers.HttpProvider(self.options.web3Provider))
  }
  return self
}

Web3Payments.prototype.getAddress = function(node) {
  const privateKey = node.privateKey
  let publicKey = ethUtil.privateToPublic(privateKey)
  publicKey = ethUtil.privateToPublic(privateKey)
  const addr = ethUtil.publicToAddress(publicKey).toString('hex')
  const checksumAddress = ethUtil.toChecksumAddress(addr)
  const address = ethUtil.addHexPrefix(checksumAddress)
  return address
}

Web3Payments.prototype.getBalance = function(address, options = {}, done) {
  let self = this
  const web3 = self.options.web3
  const { assets = [{ symbol: 'ETH', contractAddress: '0x0', decimals: 18 }] } = options
  // no need for assets if only want eth balance
  const contractAddresses = assets.map(asset => asset.symbol === 'ETH' ? '0x0' : asset.contractAddress)
  return getAddressBalances(web3, address, contractAddresses)
    .then((balances) => {
      const mappedBalances = Object.keys(balances).reduce((result, contractAddr) => {
        const asset = assets.find(a => a.contractAddress == contractAddr)
        const balance = toBigNumber(balances[contractAddr])
        return (balance.gt(ZERO) || asset.symbol === 'ETH')
          ? ({ ...result, [asset.symbol]: toMainDenomination(balance, asset.decimals) })
          : result
      }, {})
      return done(null, mappedBalances)
    })
    .catch(err => done(err))
}

Web3Payments.prototype.tokenSendData = function(address, amount, decimals) {
  let self = this
  amount = toBigNumber(amount)
  if (!self.options.web3.utils.isAddress(address)) { throw new Error('invalid address') }
  if (amount.lt(0)) { throw new Error('invalid amount') }
  if (typeof decimals !== 'number') { throw new Error('invalid decimals') }
  const dataAddress = pad(address.toLowerCase().replace('0x', ''), 64, '0')
  const power = TEN.pow(decimals)
  const dataAmount = pad(amount.times(power).toString(16), 64, '0')
  return '0xa9059cbb' + dataAddress + dataAmount
}

Web3Payments.prototype.getDefaultFeeRate = function() {
  let self = this
  return self.options.web3.eth.getGasPrice()
    .catch((e) => {
      console.log(`Failed to get ethereum dynamic fee, using default of ${DEFAULT_GAS_PRICE} wei`, e)
      return DEFAULT_GAS_PRICE
    })
    .then((gasPrice) => ({
      rate: gasPrice,
      unit: 'wei/gas',
    }))
}

Web3Payments.prototype.estimateGasLimit = function (txData) {
  let self = this
  try {
    return self.options.web3.eth.estimateGas(txData)
      .then(toBigNumber)
      .then((gasLimit) => {
        const minGasLimit = txData.data ? MIN_GAS_LIMIT_TOKEN : MIN_GAS_LIMIT_ETH
        return gasLimit.lt(minGasLimit) ? minGasLimit : gasLimit
      })
      .catch((e) => {
        console.log('Error calling web3.eth.estimateGas, falling back to fixed limits', e)
        return Promise.resolve(txData.data ? DEFAULT_GAS_LIMIT_TOKEN : DEFAULT_GAS_LIMIT_ETH)
      })
  } catch (e) {
    console.log(e)
  }
}

Web3Payments.prototype.getTxHistory = async function(address, done) {
  let self = this
  try {
    const normalHistory = await axios.get(self.options.explorerUrl, {
      params: {
        module: 'account',
        action: 'txlist',
        address: address,
        startblock: 0,
        sort: 'asc'
      }
    })
    const tokenHistory = await axios.get(self.options.explorerUrl, {
      params: {
        module: 'account',
        action: 'tokentx',
        address: address,
        startblock: 0,
        sort: 'asc'
      }
    })
    const history = normalHistory.data.result.concat(tokenHistory.data.result)
    return done(null, history)
  } catch (err) {
    return done(`unable to fetch transaction history: ${err}`)
  }
}

Web3Payments.prototype.getChainId = function() {
  let self = this
  const web3 = self.options.web3
  return web3.eth.getChainId()
    .then(chainId => chainId)
    .catch(() => 1)
}

Web3Payments.prototype.getTransaction = function(node, toAddress, amount, options = {}) {
  return Promise.resolve().then(() => {
    let self = this
    const web3 = self.options.web3
    const { asset: { contractAddress, decimals } = {} } = options
    const txData = {
      chainId: 1,
      from: self.getAddress(node),
      value: toHex(ZERO),
      to: '',
    }
    if (!contractAddress) {
      txData.to = toAddress
      txData.value = toHex(toSmallestDenomination(amount, decimals))
    } else {
      // Handle ERC20
      txData.to = contractAddress,
      txData.data = self.tokenSendData(toAddress, amount, decimals)
    }
    const { previousTx } = options
    let customNonce = options.nonce
    if (typeof customNonce === 'undefined'
      && previousTx
      && previousTx.txData.from.toLowerCase() === txData.from.toLowerCase()) {
      customNonce = toNumber(previousTx.txData.nonce) + 1
    }
    const customGasPrice = options.gasPrice
    const customGasLimit = options.gasLimit || options.gas
    const opts = [
      customGasPrice || self.getDefaultFeeRate().then(({ rate }) => rate),
      customGasLimit || self.estimateGasLimit(txData),
      customNonce || web3.eth.getTransactionCount(txData.from),
    ]
    return Promise.all(opts).then(([gasPrice, gasLimit, nonce]) => ({
      ...txData,
      gasPrice: toHex(gasPrice),
      gas: toHex(gasLimit),
      nonce: toHex(nonce),
    }))
  })
}

Web3Payments.prototype.sendTransaction = function(node, txData, options = {}) {
  let self = this
  return new Promise((resolve, reject) => {
    const { onTxHash, onReceipt, onConfirmation, onError } = options
    const tx = new Tx(txData)
    const privateKey = node.privateKey
    tx.sign(privateKey)
    const serializedTx = tx.serialize()
    const sendStatus = self.options.web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'))
    let resolved = false
    sendStatus
      .once('transactionHash', (txHash) => {
        resolve({ txid: txHash })
        resolved = true
      })
      .once('error', (e) => {
        if (!resolved) {
          // Avoid rejecting after resolve was called
          reject(e)
        }
      })
    if (typeof onTxHash === 'function') {
      sendStatus.once('transactionHash', onTxHash)
    }
    if (typeof onReceipt === 'function') {
      sendStatus.once('receipt', onReceipt)
    }
    if (typeof onConfirmation === 'function') {
      sendStatus.on('confirmation', onConfirmation)
    }
    if (typeof onError === 'function') {
      sendStatus.on('error', onError)
    }
    return sendStatus
  })
}

Web3Payments.prototype.transaction = async function(node, coin, to, amount, options = {}, done) {
  let self = this
  try {
    const txData = await self.getTransaction(node, to, amount, options)
    // const signedTxData = await self.signTransaction(node, txData)
    const txHash = await self.sendTransaction(node, txData, options)
    return done(null, txHash)
  } catch (err) {
    return done(`error completing transaction: ${err}`)
  }
}

Web3Payments.prototype.getFee = function(node, network, options = {}, done) {
  if (!options.contractAddress) {
    done(null, toTxFee(MIN_GAS_LIMIT_ETH, DEFAULT_GAS_PRICE))
  } else {
    done(null, toTxFee(MIN_GAS_LIMIT_TOKEN, DEFAULT_GAS_PRICE))
  }
}

module.exports = Web3Payments