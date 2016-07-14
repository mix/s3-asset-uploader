/**
This is not a proper test. Only used as proof of concept.
**/

var sync = require('./index').s3sync
var E = process.env
var config = {}
config.aws = {
    secret: E.AWS_SECRET_ACCESS_KEY,
    bucket: E.AWS_STORAGE_BUCKET_NAME || 'nimish-s3-asset-uploader',
    key: E.AWS_ACCESS_KEY_ID,
    cloudsearch: E.AWS_CLOUDSEARCH_ENDPOINT,
    cliHome: E.AWS_CLI_HOME || '/app/.heroku/python/bin/aws/',
    computeDataBucket: E.AWS_COMPUTE_DATA_BUCKET_NAME,
    computeScriptsBucket: E.AWS_COMPUTE_SCRIPTS_BUCKET_NAME,
    defaultRegion: E.AWS_DEFAULT_REGION || 'us-east-1'
  }

config.assets = {
    useLocal: E.USE_LOCAL_ASSET,
    digestOnly: E.DIGEST_ONLY,
    digestPath: E.DIGEST_PATH || '',
    prefix: E.ASSET_PREFIX || 'nimishtest'
  }

var digestFile = config.assets.digestPath + '/asset-map.' + Date.now() + '.json'

var LOCK_NAME = 'asset-builder'
var BUILD_FLAG = 'asset-deploy'
var DIRECTORY = 'public'

var build = sync(config.aws, {
  path: DIRECTORY
, ignorePath: 'public/js/views'
, prefix: config.assets.prefix
, digest: digestFile
, digestOnly: config.assets.digestOnly
, complete: function (uploadErr) {
    console.log('Upload error', uploadErr)
  }
})

build.init()
