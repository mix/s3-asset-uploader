var fs = require('fs')
  , crypto = require('crypto')
  , path = require('path')

  , finder = require('findit')
  , debug = require('debug')('ol:s3')
  , klass = require('klass')
  , when = require('when')
  , knox = require('knox')
  , mime = require('mime')
  , _ = require('valentine')

var S3Sync = klass(function (config, options) {
  this.options = options
  this.client = knox.createClient(config)
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
      'x-amz-acl': 'public-read'
    }
  , TYPES: {
      'js': 'utf8'
    , 'css': 'utf8'
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
      return _.extend({}, this.options.headers || {}, this.constructor.defaultHeaders)
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
          debug('wrote digest file')
          this.options.complete && this.options.complete()
        })
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
      this.client.putBuffer(
        new Buffer(JSON.stringify(this.getDigest())),
        this.digest,
        _.extend({}, this.getSettings(), this._mergeHeaders(this.digest)),
        callback.bind(this)
      )
    }
  , readFileContents: function (file) {
      return fs.readFileSync(file, this.constructor.TYPES[file.match(/\.(\w+)$/)[1]])
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

      var req = this.client.putFile(
        file,
        s3FileNameWithPrefix,
        _.extend({}, this.getSettings(), this._mergeHeaders(file)),
        this.md5PreCheck.bind(this, file, md5File, done)
      )
      req.on('error', function (e) {
        console.error('error in putting original file', e)
      })
    }
  , md5PreCheck: function (file, md5File, done) {
      this.s3FilePreCheck(md5File)
        .then(function () {
          debug('putting new file', md5File)
          var req = this.client.putFile(
            file,
            md5File,
            _.extend({}, this.getSettings(), this._mergeHeaders(file)),
            done
          )
          req.on('error', function (e) {
            console.error('error in putting new file', e)
          })
        }.bind(this), done)
    }
  , s3FilePreCheck: function (file) {
      var defer = when.defer()
      var req = this.client.getFile(file, this.handleGetFileResponse(defer))
      req.on('error', function (e) {
        console.error('error in requesting file on pre-check', file, e)
      })
      return defer.promise
    }
  , handleGetFileResponse: function (defer) {
      return function (err, res) {
        if (err) {
          console.error('error in file getFileResponse', err)
          defer.resolve()
        }
        else if (res.statusCode == 404) defer.resolve()
        else defer.reject()
      }
    }
  , abort: function (e) {
      this._timer && clearTimeout(this._timer)
      debug('S3 sync aborted', e)
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
        o['Content-Encoding'] = 'gzip'
        o['Cache-Control'] = 'max-age=1314000'
      }
      o['Content-Type'] = mime.lookup(file)
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
