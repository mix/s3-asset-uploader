var fs = require('fs')
  , crypto = require('crypto')
  , path = require('path')
  , finder = require('findit')
  , debug = require('debug')('mix:s3')
  , klass = require('klass')
  , Promise = require('bluebird')
  , AWS = require('aws-sdk')
  , mime = require('mime')
  , v = require('valentine')

var S3Sync = klass(function (config, options) {
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
})
  .statics({
    md5: function (text) {
      return crypto
        .createHash('md5')
        .update(text)
        .digest('hex')
    }
  , defaultHeaders: {
      'ACL': 'public-read'
    }
  , TYPES: {
      'js': 'utf8'
    , 'css': 'utf8'
    , 'sass': 'utf8'
    , 'scss': 'utf8'
    , 'png': 'binary'
    , 'jpg': 'binary'
    , 'jpeg': 'binary'
    , 'gif': 'binary'
    , 'ico': 'binary'
    }
  })
  .methods({
    init: function () {
      this.finder(this.path)
        .on('file', this.addFile.bind(this))
        .on('end', this.start.bind(this))
    }
  , getSettings: function () {
      return v.extend({}, this.options.headers || {}, this.constructor.defaultHeaders)
    }
  , finder: function (path) {
      return finder(path)
    }
  , addFile: function (file) {
      if (!this.options.ignorePath) this._files.push(file)
      else if (!(new RegExp('^' + this.options.ignorePath).test(path.dirname(file)))) {
        this._files.push(file)
      }
    }
  , start: function () {
      if (!this._files.length) {
        this.writeDigestFile(function (err, resp) {
          if (err) debug('error writing digest file', err)
          else debug('wrote digest file', resp)
          this.options.complete && this.options.complete(err)
        }.bind(this))
      }
      else if (this._inProgress) (this._timer = setTimeout(this.start.bind(this), 50))
      else {
        if (this.options.digestOnly) {
          this._addToDigest(this._files.pop())
          this.start()
        }
        else {
          this._inProgress = true
          this.put(this._files.pop(), this.handlePutResponse.bind(this))
        }
      }
    }
  , writeDigestFile: function (callback) {
      var headers = v.extend({}, this.getSettings(), this._mergeHeaders(this.digest))

      this.client.upload(v.extend({
        Body: JSON.stringify(this.getDigest()),
        Bucket: this.bucket,
        Key: this.digest
      }, headers))
      .send(callback)
    }
  , readFileContents: function (file) {
      return fs.readFileSync(file, this.constructor.TYPES[file.split('.').pop()])
    }
  , hashContents: function (file) {
      var contents = this.readFileContents(file)
        , up = file.substring(this.path.length)
        , hash = this.constructor.md5(contents)
      return up.replace(/(\.\w+)$/, '-' + hash + '$1')
    }
  , put: function (file, done) {
      this._addToDigest(file)

      var s3FileName = file.substring(this.path.length)
        , s3FileNameWithPrefix = this.prefix + s3FileName
        , md5File = this._digest[s3FileName]

      debug('putting original file %s at destination %s', file, s3FileNameWithPrefix)

      var body =  fs.createReadStream(file)
      var headers = v.extend({}, this.getSettings(), this._mergeHeaders(file))

      this.client.upload(v.extend({
        Body: body,
        Bucket: this.bucket,
        Key: s3FileNameWithPrefix
      }, headers))
      .send(function(err, data) {
        if (err) {
          console.error('error in putting original file', err)
          done(err)
        } else {
          this.md5PreCheck(file, md5File, done)
        }
      }.bind(this))
    }
  , md5PreCheck: function (file, md5File, done) {
      this.s3FilePreCheck(md5File)
        .then(function () {
          debug('putting new file', md5File)
          var md5body =  fs.createReadStream(file)
          var md5headers = v.extend({}, this.getSettings(), this._mergeHeaders(md5File))
          this.client.upload(v.extend({
            Body: md5body,
            Bucket: this.bucket,
            Key: md5File
          }, md5headers))
          .send(function(err, data) {
            if (err) {
              console.error('error in putting new file', err)
              done(err)
            }
            else{ done() }
          })
        }.bind(this), done)
    }
  , s3FilePreCheck: function (file) {
      // check for existence of file and reject if it exists to avoid uploading same file again
      return new Promise(function (resolve, reject) {
        this.client.getObject({
          Bucket: this.bucket,
          Key: file
        }, function (err, res) {
          if (this.httpResponse.statusCode == 404) resolve()
          else {
            console.log('error in getFileResponse', this.httpResponse.statusCode, err)
            reject(new Error('S3 File precheck failed [' + this.httpResponse.statusCode + '] for ' + file))
          }
        })
      }.bind(this))
    }
  , abort: function (e) {
      this._timer && clearTimeout(this._timer)
      debug('S3 sync aborted', e)
      this.options.complete && this.options.complete(new Error('Sync aborted'))
    }
  , getDigest: function () {
      return this._digest
    }
  , handlePutResponse: function (error, resp) {
      if (error) {
        console.error('ERROR', error)
        this.options.error && this.options.error(error)
        this.abort(error)
      }
      else {
        this._inProgress = false
        this.start()
      }
    }
  , _mergeHeaders: function (file) {
      var o = {}
      if (file.match('.gz')) {
        o['ContentEncoding'] = 'gzip'
        o['CacheControl'] = 'max-age=1314000'
      }
      o['ContentType'] = mime.lookup(file)
      // overwrite `gz` headers
      if (file.match('.js')) o['Content-Type'] = 'application/javascript'
      if (file.match('.css')) o['Content-Type'] = 'text/css'
      return o
    }
  , _addToDigest: function (file) {
      var md5File = this.prefix + this.hashContents(file)
        , s3FileName = file.substring(this.path.length)

      this._digest[s3FileName] = md5File
    }
  })

module.exports.s3sync = function (config, options) {
  return new S3Sync(config, options)
}
module.exports.S3sync = S3Sync
