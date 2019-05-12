const web3 = require('web3')
const pad = require('pad-left')
const toSmallestDenomination = require('./utilites/convert').toSmallestDenomination
const toMainDenomination = require('./utilites/convert').toMainDenomination
const toHex = require('./utilites/convert').toHex
const toTxFee = require('./utilites/convert').toTxFee
const toBigNumber = require('./utilites/numbers').toBigNumber
const toNumber = require('./utilites/numbers').toNumber
const ZERO = require('./utilites/numbers').ZERO

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
    console.log('WARN: Using default eth provider. It is highly suggested you set one yourself!', self.options.web3Provider)
    self.options.web3 = new web3(new web3.default.providers.HttpProvider(self.options.web3Provider))
  }
  return self
}

Web3Payments.prototype.getAddress = function(network) {
  const keyPair = bitcoin.ECPair.makeRandom({ network })
  let { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network })
  const addr = ethUtil.publicToAddress(publicKey).toString('hex')
  const checksumAddress = ethUtil.toChecksumAddress(addr)
  address = ethUtil.addHexPrefix(checksumAddress)
  return address
}

function batchRequest(batch, batchableFn, ...fnArgs) {
  if (batch) {
    return new Promise((resolve, reject) => {
      batch.add(batchableFn.request(...fnArgs, (err, result) => {
        if (err) { return reject(err) }
        resolve(result)
      }))
    })
  }
  return batchableFn(...fnArgs)
}

function tokenBalanceData(walletAddress) {
  if (walletAddress.startsWith('0x')) {
    walletAddress = walletAddress.slice(2)
  }
  return config.tokenFunctionSignatures.balanceOf + pad(walletAddress, 64, '0')
};

Web3Payments.prototype.getBalance = function(address, options, done) {
  let self = this
  const { web3Batch, asset, contractAddress } = options
  const web3 = self.options.web3
  let request
  if (!contractAddress) {
    request = batchRequest(web3Batch, web3.eth.getBalance, address, 'latest')
  } else { // Handle ERC20
    request = batchRequest(web3Batch, web3.eth.call, {
      to: contractAddress,
      data: tokenBalanceData(address),
    }, 'latest')
  }
  return request
    .then((balance) => done ? 
      done(null, toMainDenomination(balance, asset.decimals)) : 
      toMainDenomination(balance, asset.decimals))
    .catch(err => done(`error retrieving balance: ${err}`))
}

Web3Payments.prototype.getAllBalances = function(address, assets, done) {
  let self = this
  const web3 = self.options.web3
  const batches = []
  const balanceRequests = assets.map((asset, i) => {
    const batchNumber = Math.floor(i / GET_BALANCES_BATCH_SIZE)
    let batch = batches[batchNumber]
    if (!batch) {
      batch = new web3.BatchRequest()
      batches[batchNumber] = batch
    }
    return self.getBalance(address, { web3Batch: batch, asset: asset })
      .then((balance) => ({ symbol: asset.symbol, balance }))
  })
  batches.forEach((batch) => batch.execute())
  return Promise.all(balanceRequests)
    .then((balances) => done(null, balances.reduce(
    (result, { symbol, balance }) => (balance.gt(ZERO) || symbol === 'ETH')
      ? ({ ...result, [symbol]: balance })
      : result,
    {})))
    .catch(err => done(`Unable to get all balances: ${err}`))
}

Web3Payments.prototype.tokenSendData = function(address, amount, decimals) {
  let self = this
  amount = toBigNumber(amount)
  if (!self.options.web3.utils.isAddress(address(address))) { throw new Error('invalid address') }
  if (amount.lessThan(0)) { throw new Error('invalid amount') }
  if (typeof decimals !== 'number') { throw new Error('invalid decimals') }
  const dataAddress = pad(address.toLowerCase().replace('0x', ''), 64, '0')
  const power = TEN.toPower(decimals)
  const dataAmount = pad(amount.times(power).toString(16), 64, '0')
  return config.tokenFunctionSignatures.transfer + dataAddress + dataAmount
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
  const errorFallback = (e) => {
    console.log('Error calling web3.eth.estimateGas, falling back to fixed limits', e)
    return Promise.resolve(txData.data ? DEFAULT_GAS_LIMIT_TOKEN : DEFAULT_GAS_LIMIT_ETH)
  }
  try {
    return self.options.web3.eth.estimateGas(txData)
      .then(toBigNumber)
      .then((gasLimit) => {
        const minGasLimit = txData.data ? MIN_GAS_LIMIT_TOKEN : MIN_GAS_LIMIT_ETH
        return gasLimit.lt(minGasLimit) ? minGasLimit : gasLimit
      })
      .catch(errorFallback)
  } catch (e) {
    return errorFallback(e)
  }
}

Web3Payments.prototype.getTransaction = function(toAddress, amount, network, options) {
  return Promise.resolve().then(() => {
    let self = this
    const web3 = self.options.web3
    const txData = {
      chainId: config.ethereumChainId,
      from: this.getAddress(network),
      value: toHex(ZERO),
      data: '',
      to: '',
    }
    if (!options.contractAddress) {
      txData.to = toAddress
      txData.value = toHex(toSmallestDenomination(amount, options.decimals))
    } else if (options.contractAddress) {
      // Handle ERC20
      txData.to = options.contractAddress,
      txData.data = this.tokenSendData(toAddress, amount, options.decimals)
    } else {
      throw new Error(`Unsupported asset ${asset.symbol || asset} provided to EthereumWallet.createTransaction`)
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
      customGasPrice || this.getDefaultFeeRate().then(({ rate }) => rate),
      customGasLimit || this.estimateGasLimit(txData),
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

Web3Payments.prototype.sendTransaction = function(txData, options) {
  return new Promise((resolve, reject) => {
    const { onTxHash, onReceipt, onConfirmation, onError } = options
    let resolved = false
    const sendStatus = self.options.web3.eth.sendTransaction(txData)
    sendStatus
      .once('transactionHash', (txHash) => {
        resolve(txHash)
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

Web3Payments.prototype.transaction = async function(node, coin, to, amount, options, done) {
  let self = this
  try {
    const txData = await self.getTransaction(to, amount, coin.network, options)
    const txHash = await self.sendTransaction(txData, options)
    return done(null, txHash)
  } catch (err) {
    return done(`error completing transaction: ${err}`)
  }
}

Web3Payments.prototype.getFee = function(node, network, options, done) {
  let self = this
  if (!options.contractAddress) {
    done(null, toTxFee(MIN_GAS_LIMIT_ETH, DEFAULT_GAS_PRICE))
  } else {
    done(null, toTxFee(MIN_GAS_LIMIT_TOKEN, DEFAULT_GAS_PRICE))
  }
}

module.exports = Web3Payments