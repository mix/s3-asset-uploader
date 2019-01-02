/**
 * Top-level s3-asset-uploader module
 * @module s3-asset-uploader
 * @see README.md
 */

// Node imports
const fs = require('fs')
const path = require('path')
// NPM imports
const debug = require('debug')('s3-asset-uploader')
const AWS = require('aws-sdk')
const Bluebird = require('bluebird')
// Lib imports
const directoryLib = require('./lib/directory')
const fileLib = require('./lib/file')
const hashLib = require('./lib/hash')
const transformLib = require('./lib/transform')

const FILE_EXTENSION_REGEXP = /((\.\w+)?\.\w+)$/
const DEFAULT_ACL = 'public-read'
const DEFAULT_DIGEST_FILE_NAME = 'asset-map.json'
const DEFAULT_GZIP_CACHE_CONTROL = `max-age=${365*24*60*60}` // 1 year (in seconds)
const DEFAULT_GZIP_HEADERS = {
  'ContentEncoding': 'gzip',
  'CacheControl': DEFAULT_GZIP_CACHE_CONTROL
}

/**
 * The configuration Object passed into the `S3Sync` constructor
 * @typedef {Object} S3SyncConfig
 * @property {string} key - your AWS access key ID
 * @property {string} secret - your AWS secret access key
 * @property {AWS.S3.BucketName} bucket - the name of the destination AWS S3 bucket
 */

/**
 * The options Object passed into the `S3Sync` constructor
 * @typedef {Object} S3SyncOptions
 * @property {string} path - the base path to synchronize with S3
 * @property {Array.<(RegExp|string)>} [ignorePaths] - do not synchronize these paths with S3
 * @property {string} [prefix] - prepended to all destination file names when uploaded
 * @property {AWS.S3.ObjectKey} [digestFileName] - the destination file name of the generated digest file
 * @property {boolean} [digestOnly] - upload only the generated digest file
 * @property {boolean} [dryRun] - don't upload anything, just log what would have been uploaded
 * @property {S3UploadHeaders} [headers] - params used by AWS.S3 upload method
 * @property {S3UploadHeaders} [gzipHeaders] - params used by AWS.S3 upload method for GZIP files
 */

/** @typedef {string} AbsoluteFilePath */
/** @typedef {string} RelativeFileName */
/** @typedef {AWS.S3.ObjectKey} HashedS3Key */
/** @typedef {Object.<RelativeFileName,HashedS3Key>} S3SyncDigest */
/** @typedef {AWS.S3.PutObjectRequest} S3UploadParams */
/** @typedef {(AWS.S3.CompleteMultipartUploadOutput|void)} S3UploadResult */

/**
 * Some (but not all) of the parameters needed for `S3UploadParams`
 * @typedef {Object} S3UploadHeaders
 * @property {AWS.S3.ObjectCannedACL} ACL
 * @property {AWS.S3.BucketName} Bucket
 * @property {AWS.S3.CacheControl} [CacheControl]
 * @property {AWS.S3.ContentType} ContentType
 * @property {AWS.S3.ContentEncoding} [ContentEncoding]
 */

/**
 * Class representing an operation to synchronize a directory with an Amazon S3 bucket
 */
class S3Sync {
  /**
   * @param {S3SyncConfig} config
   * @param {S3SyncOptions} options
   * @constructor
   */
  constructor(config, options) {
    this.client = new AWS.S3({
      accessKeyId: config.key,
      secretAccessKey: config.secret
    })
    this.bucket = config.bucket
    this.path = fs.realpathSync(options.path)
    this.ignorePaths = options.ignorePaths || []
    this.digestFileName = options.digestFileName || DEFAULT_DIGEST_FILE_NAME
    this.digestOnly = options.digestOnly || false
    this.dryRun = options.dryRun || false
    this.prefix = options.prefix || ''
    this.headers = options.headers || {}
    this.gzipHeaders = options.gzipHeaders || DEFAULT_GZIP_HEADERS
    this.reset()
  }

  /**
   * The main work-horse method that performs all of the sub-tasks to synchronize
   * @returns {Bluebird<S3SyncDigest>}
   * @public
   */
  run() {
    return this.gatherFiles()
    .then(() => this.addFilesToDigest())
    .then(() => this.syncFiles())
    .then(() => this.uploadDigest())
    .then(() => this.digest)
    .finally(() => this.reset())
  }

  /**
   * Resets the `S3Sync` instance back to its initial state
   * @returns {void}
   * @private
   */
  reset() {
    /** @type {Array.<AbsoluteFilePath>} */
    this.gatheredFilePaths = []
    /** @type {Object.<AbsoluteFilePath,AWS.S3.ETag>} */
    this.filePathToEtagMap = {}
    /** @type {S3SyncDigest} */
    this.digest = {}
  }

  /**
   * Walks the `this.path` directory and collects all of the file paths
   * @returns {Bluebird<void>}
   * @private
   */
  gatherFiles() {
    return directoryLib.getFileNames(this.path, this.ignorePaths)
    .then(filePaths => {
      this.gatheredFilePaths.push(...filePaths)
    })
  }

  /**
   * Iterates through the gathered files and generates the hashed digest mapping
   * @returns {Bluebird<void>}
   * @private
   */
  addFilesToDigest() {
    return Bluebird.mapSeries(this.gatheredFilePaths, filePath => {
      return this.addFileToDigest(filePath)
    })
    .then(() => {}) // Normalize fulfilled value to void/undefined
  }

  /**
   * Uploads the gathered files
   * @returns {Bluebird<void>}
   * @private
   */
  syncFiles() {
    if (this.digestOnly) {
      return Bluebird.resolve()
    }
    return Bluebird.mapSeries(this.gatheredFilePaths, filePath => {
      return this.uploadOriginalFile(filePath)
      .then(() => this.uploadHashedFile(filePath))
    })
    .then(() => {}) // Normalize fulfilled value to void/undefined
  }

  /**
   * Hashes the file and adds it to the digest
   * @param {AbsoluteFilePath} filePath
   * @returns {Bluebird<void>}
   * @private
   */
  addFileToDigest(filePath) {
    return hashLib.hashFromFile(filePath)
    .then(hash => {
      const originalFileName = this.relativeFileName(filePath)
      const hashedFileName = this.hashedFileName(originalFileName, hash)
      this.filePathToEtagMap[filePath] = hash
      this.digest[originalFileName] = hashedFileName
    })
  }

  /**
   * @returns {Bluebird<S3UploadResult>}
   * @private
   */
  uploadDigest() {
    debug('Uploading digest file', this.digestFileName)
    return this.upload({
      'ACL': DEFAULT_ACL,
      'Body': JSON.stringify(this.digest),
      'Bucket': this.bucket,
      'ContentType': 'application/json',
      'Key': this.digestFileName
    })
  }

  /**
   * @param {AbsoluteFilePath} filePath
   * @returns {Bluebird<S3UploadResult>}
   * @private
   */
  uploadOriginalFile(filePath) {
    const originalFileName = this.relativeFileName(filePath)
    const key = this.s3KeyForRelativeFileName(originalFileName)
    const etag = this.filePathToEtagMap[filePath]
    return this.shouldUpload(key, etag)
    .then(shouldUpload => {
      if (shouldUpload) {
        const headers = this.fileHeaders(filePath)
        const params = Object.assign({}, headers, {
          'Key': key,
          'Body': fs.createReadStream(filePath)
        })
        debug('Uploading original file: ', key)
        return this.upload(params)
      }
    })
  }

  /**
   * @param {AbsoluteFilePath} filePath
   * @returns {Bluebird<S3UploadResult>}
   * @private
   */
  uploadHashedFile(filePath) {
    const originalFileName = this.relativeFileName(filePath)
    const key = this.digest[originalFileName]
    if (!key) {
      // This should never happen under normal circumstances!
      debug('Missing hash for original file: ', originalFileName)
      return Bluebird.resolve()
    }
    return transformLib.replaceHashedFilenames({
      filePath,
      relativeFileName: originalFileName,
      digest: this.digest
    })
    .then(({ transformed, stream, hash }) => {
      const etag = transformed ? hash : this.filePathToEtagMap[filePath]
      return this.shouldUpload(key, etag)
      .then(shouldUpload => {
        if (shouldUpload) {
          const headers = this.fileHeaders(filePath)
          const params = Object.assign({}, headers, {
            'Key': key,
            'Body': stream
          })
          debug('Uploading hashed file: ', key)
          return this.upload(params)
        }
      })
    })
  }

  /**
   * @param {S3UploadParams} params
   * @returns {Bluebird<S3UploadResult>}
   * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property
   * @private
   */
  upload(params) {
    if (this.dryRun) {
      debug('[DRY-RUN] NOT uploading', params['Key'])
      return Bluebird.resolve()
    }
    return Bluebird.fromCallback(callback => {
      this.client.upload(params, callback)
    })
  }

  /**
   * @param {AWS.S3.ObjectKey} key
   * @param {AWS.S3.ETag} etag
   * @returns {Bluebird<boolean>}
   * @private
   */
  shouldUpload(key, etag) {
    return Bluebird.fromCallback(callback => {
      this.client.headObject({
        'Bucket': this.bucket,
        'Key': key,
        'IfNoneMatch': etag
      }, callback)
    })
    .then(() => {
      // File found, ETag does not match
      return true
    })
    .catch(err => {
      switch (err.name) {
        case 'NotFound': return true
        case 'NotModified': return false
        default: throw err
      }
    })
  }

  /**
   * @param {AbsoluteFilePath} filePath
   * @returns {RelativeFileName}
   * @private
   */
  relativeFileName(filePath) {
    return filePath.substring(this.path.length + path.sep.length)
  }

  /**
   * @param {RelativeFileName} fileName
   * @returns {AWS.S3.ObjectKey}
   * @private
   */
  s3KeyForRelativeFileName(fileName) {
    return path.posix.join(this.prefix, fileName)
  }

  /**
   * @param {RelativeFileName} fileName
   * @param {AWS.S3.ETag} hash
   * @returns {HashedS3Key}
   * @private
   */
  hashedFileName(fileName, hash) {
    return this.s3KeyForRelativeFileName(fileName)
    .replace(FILE_EXTENSION_REGEXP, `-${hash}$1`)
  }

  /**
   * @param {AbsoluteFilePath} filePath
   * @returns {S3UploadHeaders}
   * @private
   */
  fileHeaders(filePath) {
    const defaultHeaders = {
      'ACL': DEFAULT_ACL,
      'Bucket': this.bucket
    }
    const fileHeaders = {
      'ContentType': fileLib.getContentType(filePath)
    }
    const gzipHeaders = fileLib.isGzipped(filePath)
    ? this.gzipHeaders
    : {}
    return Object.assign(
      defaultHeaders,
      this.headers,
      fileHeaders,
      gzipHeaders
    )
  }
}

module.exports = {
  S3Sync
}
