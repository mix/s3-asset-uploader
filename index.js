const fs = require('fs')
const crypto = require('crypto')
const path = require('path')
const finder = require('findit')
const debug = require('debug')('mix:s3')
const Promise = require('bluebird')
const AWS = require('aws-sdk')
const mime = require('mime')

const DEFAULT_HEADERS = {
  'ACL': 'public-read'
}
const TYPES = {
  'js': 'utf8',
  'css': 'utf8',
  'sass': 'utf8',
  'scss': 'utf8',
  'png': 'binary',
  'jpg': 'binary',
  'jpeg': 'binary',
  'gif': 'binary',
  'ico': 'binary'
}

class S3Sync {
  constructor (config, options) {
    this.options = options
    AWS.config.accessKeyId = config.key
    AWS.config.secretKeyId = config.secret
    this.client = new AWS.S3()
    this.bucket = config.bucket
    this.path = options.path
    this.prefix = options.prefix || ''
    this.digest = options.digest
    this._inProgress = false
    this._files = []
    this._digest = {}
    this._timer
  }

  static md5(text) {
    return crypto
    .createHash('md5')
    .update(text)
    .digest('hex')
  }

  init() {
    this.finder(this.path)
    .on('file', this.addFile.bind(this))
    .on('end', this.start.bind(this))
  }

  getSettings() {
    return Object.assign({}, this.options.headers || {}, DEFAULT_HEADERS)
  }

  finder(path) {
    return finder(path)
  }

  addFile(file) {
    if (!this.options.ignorePath) {
      this._files.push(file)
    } else if (!(new RegExp('^' + this.options.ignorePath).test(path.dirname(file)))) {
      this._files.push(file)
    }
  }

  start() {
    if (!this._files.length) {
      this.writeDigestFile((err, resp) => {
        if (err) {
          debug('error writing digest file', err)
        } else {
          debug('wrote digest file', resp)
        }
        this.options.complete && this.options.complete(err)
      })
    } else if (this._inProgress) {
      this._timer = setTimeout(this.start.bind(this), 50)
    } else {
      if (this.options.digestOnly) {
        addToDigest.call(this, this._files.pop())
        this.start()
      } else {
        this._inProgress = true
        this.put(this._files.pop(), this.handlePutResponse.bind(this))
      }
    }
  }

  writeDigestFile(callback) {
    const headers = Object.assign({}, this.getSettings(), mergeHeaders(this.digest))

    this.client.upload(Object.assign({
      Body: JSON.stringify(this.getDigest()),
      Bucket: this.bucket,
      Key: this.digest
    }, headers))
    .send(callback)
  }

  readFileContents(file) {
    return fs.readFileSync(file, TYPES[file.split('.').pop()])
  }

  hashContents(file) {
    const contents = this.readFileContents(file)
    const up = file.substring(this.path.length)
    const hash = S3Sync.md5(contents)
    return up.replace(/(\.\w+)$/, '-' + hash + '$1')
  }

  put(file, done) {
    addToDigest.call(this, file)

    const s3FileName = file.substring(this.path.length)
    const s3FileNameWithPrefix = this.prefix + s3FileName
    const md5File = this._digest[s3FileName]

    debug('putting original file %s at destination %s', file, s3FileNameWithPrefix)

    const body =  fs.createReadStream(file)
    const headers = Object.assign({}, this.getSettings(), mergeHeaders(file))

    this.client.upload(Object.assign({
      Body: body,
      Bucket: this.bucket,
      Key: s3FileNameWithPrefix
    }, headers))
    .send(err => {
      if (err) {
        done(err)
      } else {
        this.md5PreCheck(file, md5File, done)
      }
    })
  }

  md5PreCheck(file, md5File, done) {
    this.s3FilePreCheck(md5File)
    .then(() => {
      debug('putting new file', md5File)
      const md5body =  fs.createReadStream(file)
      const md5headers = Object.assign({}, this.getSettings(), mergeHeaders(md5File))
      this.client.upload(Object.assign({
        Body: md5body,
        Bucket: this.bucket,
        Key: md5File
      }, md5headers))
      .send(err => {
        if (err) {
          done(err)
        } else{
          done()
        }
      })
    })
    .catch(err => {
      if (/already exists/i.test(err.message)) {
        done()
      } else {
        done(err)
      }
    })
  }

  s3FilePreCheck(file) {
    // check for existence of file and reject if it exists to avoid uploading same file again
    return new Promise((resolve, reject) => {
      this.client.getObject({
        Bucket: this.bucket,
        Key: file
      }, function (err) {
        if (this.httpResponse.statusCode == 404) {
          resolve()
        } else if (this.httpResponse.statusCode == 200) {
          reject(new Error('File already exists - ' + file))
        } else {
          reject(
            new Error('S3 File precheck failed [' + this.httpResponse.statusCode + '] for ' +
              file + ': ' + err.message)
          )
        }
      })
    })
  }

  abort(e) {
    this._timer && clearTimeout(this._timer)
    debug('S3 sync aborted', e)
    this.options.complete && this.options.complete(new Error('Sync aborted'))
  }

  getDigest() {
    return this._digest
  }

  handlePutResponse(error) {
    if (error) {
      this.options.error && this.options.error(error)
      this.abort(error)
    } else {
      this._inProgress = false
      this.start()
    }
  }
}

module.exports = {
  S3Sync
}

function mergeHeaders(file) {
  const o = {}
  if (file.match('.gz')) {
    o['ContentEncoding'] = 'gzip'
    o['CacheControl'] = 'max-age=1314000'
  }
  o['ContentType'] = mime.lookup(file)
  // overwrite `gz` headers
  if (file.match('.js')) {
    o['ContentType'] = 'application/javascript'
  }
  if (file.match('.css')) {
    o['ContentType'] = 'text/css'
  }
  return o
}

function addToDigest(file) {
  const md5File = this.prefix + this.hashContents(file)
  const s3FileName = file.substring(this.path.length)
  this._digest[s3FileName] = md5File
}
