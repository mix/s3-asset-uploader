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
const HASHED_FILENAME_REGEXP = /(-[0-9a-f]{32})((\.\w+)+)$/
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
 * @property {Array.<(RegExp|string)>} [ignorePaths] - skip these paths when gathering files
 * @property {AWS.S3.ObjectKey} [digestFileKey] - the destination key of the generated digest file
 * @property {string} [prefix] - prepended to all destination file names when uploaded
 * @property {S3UploadHeaders} [headers] - extra params used by `AWS.S3` upload method
 * @property {S3UploadHeaders} [gzipHeaders] - extra params used by `AWS.S3` upload method for GZIP files
 * @property {RegExp|boolean} [hashedOriginalFileRegexp] - respect hashes in original filenames
 * @property {boolean} [includePseudoUnhashedOriginalFilesInDigest] - add pseudo-entries to the digest
 * @property {boolean} [noUpload] - don't upload anything, just generate a digest mapping
 * @property {boolean} [noUploadDigestFile] - don't upload the digest mapping file
 * @property {boolean} [noUploadOriginalFiles] - don't upload the original (unhashed) files
 * @property {boolean} [noUploadHashedFiles] - don't upload the hashed files
 */

/** @typedef {string} AbsoluteFilePath */
/** @typedef {string} RelativeFileName */
/** @typedef {AWS.S3.ObjectKey} HashedS3Key */
/** @typedef {Object.<RelativeFileName,HashedS3Key>} S3SyncDigest */
/** @typedef {AWS.S3.PutObjectRequest} S3UploadParams */
/** @typedef {(AWS.S3.CompleteMultipartUploadOutput|void)} S3UploadResult */

/**
 * @typedef {Object} S3SyncFileResult
 * @property {string} filePath
 * @property {S3UploadResult} originalFile
 * @property {S3UploadResult} hashedFile
 */

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
    this.digestFileKey = options.digestFileKey || DEFAULT_DIGEST_FILE_NAME
    this.prefix = options.prefix || ''
    // Header options
    this.headers = options.headers || {}
    this.gzipHeaders = options.gzipHeaders || DEFAULT_GZIP_HEADERS
    // Upload options
    this.noUpload = Boolean(options.noUpload)
    this.noUploadDigestFile = Boolean(options.noUploadDigestFile)
    this.noUploadOriginalFiles = Boolean(options.noUploadOriginalFiles)
    this.noUploadHashedFiles = Boolean(options.noUploadHashedFiles)
    // Hashed original file options
    if (options.hashedOriginalFileRegexp instanceof RegExp) {
      this.hashedOriginalFileRegexp = options.hashedOriginalFileRegexp
    } else if (options.hashedOriginalFileRegexp === true) {
      this.hashedOriginalFileRegexp = HASHED_FILENAME_REGEXP
    }
    this.includePseudoUnhashedOriginalFilesInDigest =
      Boolean(options.includePseudoUnhashedOriginalFilesInDigest)
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
    .then(() => this.uploadDigestFile())
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
   * @returns {Bluebird<S3SyncDigest>}
   * @private
   */
  addFilesToDigest() {
    return Bluebird.mapSeries(this.gatheredFilePaths, filePath => {
      return this.addFileToDigest(filePath)
    })
    .then(() => this.digest)
  }

  /**
   * Uploads the gathered files
   * @returns {Bluebird<Array.<S3SyncFileResult>>}
   * @private
   */
  syncFiles() {
    return Bluebird.mapSeries(this.gatheredFilePaths, filePath => {
      return Bluebird.props({
        filePath,
        originalFile: this.uploadOriginalFile(filePath),
        hashedFile: this.uploadHashedFile(filePath)
      })
    })
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
      this.filePathToEtagMap[filePath] = hash
      const originalFileName = this.relativeFileName(filePath)
      const originalFileKey = this.s3KeyForRelativeFileName(originalFileName)
      if (this.isHashedFileName(originalFileName)) {
        if (this.includePseudoUnhashedOriginalFilesInDigest) {
          const unhashedFileName = this.unhashedFileName(originalFileName)
          this.digest[unhashedFileName] = originalFileKey
        }
        this.digest[originalFileName] = originalFileKey
      } else {
        const hashedFileKey = this.hashedFileKey(originalFileKey, hash)
        this.digest[originalFileName] = hashedFileKey
      }
    })
  }

  /**
   * @returns {Bluebird<S3UploadResult>}
   * @private
   */
  uploadDigestFile() {
    const key = this.digestFileKey
    if (this.noUploadDigestFile) {
      debug(`SKIPPING key[${key}] reason[noUploadDigestFile]`)
      return Bluebird.resolve()
    }
    return this.upload({
      'ACL': DEFAULT_ACL,
      'Body': JSON.stringify(this.digest),
      'Bucket': this.bucket,
      'ContentType': 'application/json',
      'Key': key
    })
  }

  /**
   * @param {AbsoluteFilePath} filePath
   * @returns {Bluebird<S3UploadResult>}
   * @private
   */
  uploadOriginalFile(filePath) {
    const originalFileName = this.relativeFileName(filePath)
    const originalFileKey = this.s3KeyForRelativeFileName(originalFileName)
    if (this.noUploadOriginalFiles && !this.isHashedFileName(originalFileName)) {
      debug(`SKIPPING key[${originalFileKey}] reason[noUploadOriginalFiles]`)
      return Bluebird.resolve()
    }
    const etag = this.filePathToEtagMap[filePath]
    return this.shouldUpload(originalFileKey, etag)
    .then(shouldUpload => {
      if (shouldUpload) {
        const headers = this.fileHeaders(filePath)
        const params = Object.assign({}, headers, {
          'Key': originalFileKey,
          'Body': fs.createReadStream(filePath)
        })
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
    const originalFileKey = this.s3KeyForRelativeFileName(originalFileName)
    const hashedFileKey = this.digest[originalFileName]
    if (!hashedFileKey) {
      // This should never happen under normal circumstances!
      debug(`SKIPPING filePath[${filePath}] reason[NotInDigest]`)
      return Bluebird.resolve()
    }
    if (hashedFileKey === originalFileKey) {
      debug(`SKIPPING key[${hashedFileKey}] reason[originalFileIsHashed]`)
      return Bluebird.resolve()
    }
    if (this.noUploadHashedFiles) {
      debug(`SKIPPING key[${hashedFileKey}] reason[noUploadHashedFiles]`)
      return Bluebird.resolve()
    }
    return transformLib.replaceHashedFilenames({
      filePath,
      relativeFileName: originalFileName,
      digest: this.digest
    })
    .then(({ transformed, stream, hash }) => {
      const etag = transformed ? hash : this.filePathToEtagMap[filePath]
      return this.shouldUpload(hashedFileKey, etag)
      .then(shouldUpload => {
        if (shouldUpload) {
          const headers = this.fileHeaders(filePath)
          const params = Object.assign({}, headers, {
            'Key': hashedFileKey,
            'Body': stream
          })
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
    const key = params['Key']
    if (this.noUpload) {
      debug(`SKIPPING key[${key}] reason[noUpload]`)
      return Bluebird.resolve()
    }
    debug(`UPLOADING key[${key}]`)
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
    if (this.noUpload) {
      debug(`SKIPPING key[${key}] reason[noUpload]`)
      return Bluebird.resolve(false)
    }
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
        case 'NotModified':
          debug(`SKIPPING key[${key}] reason[NotModified]`)
          return false
        case 'NotFound':
          return true
        default:
          throw err
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
   * @param {AWS.S3.ObjectKey} fileKey
   * @param {AWS.S3.ETag} hash
   * @returns {HashedS3Key}
   * @private
   */
  hashedFileKey(fileKey, hash) {
    return fileKey.replace(FILE_EXTENSION_REGEXP, `-${hash}$1`)
  }

  /**
   * @param {RelativeFileName} fileName
   * @returns {boolean}
   * @private
   */
  isHashedFileName(fileName) {
    return this.hashedOriginalFileRegexp
    ? this.hashedOriginalFileRegexp.test(fileName)
    : false
  }

  /**
   * @param {RelativeFileName} hashedFileName
   * @returns {RelativeFileName}
   * @private
   */
  unhashedFileName(hashedFileName) {
    return hashedFileName.replace(HASHED_FILENAME_REGEXP, '$2')
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
