## AWS S3 asset uploader

[![Greenkeeper badge](https://badges.greenkeeper.io/mix/s3-asset-uploader.svg)](https://greenkeeper.io/)

Synchronizes a local directory with an Amazon S3 bucket

### Options

Key | Type | Description
--- | ---- | -----------
`path` (**REQUIRED**) | `string` | the base path to synchronize with S3
`ignorePaths` | `Array.<(RegExp\|string)>` | skip these paths when gathering files
`digestFileKey` | `AWS.S3.ObjectKey` | the destination key of the generated digest file
`prefix` | `string` | prepended to file names **(but not `digestFileKey`!)** when uploaded
`headers` | `S3UploadHeaders` | extra params used by `AWS.S3` upload method
`gzipHeaders` | `S3UploadHeaders` | extra params used by `AWS.S3` upload method for GZIP files
`gzipHashedFileKeyRegexp` | `RegExp` | gzip the hashed files that match this pattern
`noUpload` | `boolean` | don't upload anything, just generate a digest mapping
`noUploadDigestFile` | `boolean` | don't upload the digest mapping file
`noUploadOriginalFiles` | `boolean` | don't upload the original (unhashed) files
`noUploadHashedFiles` | `boolean` | don't upload the hashed files
`hashedOriginalFileRegexp` | `RegExp | boolean` | respect hashes in original filenames; use this if your webpack output pattern includes `[chunkhash]`
`includePseudoUnhashedOriginalFilesInDigest` | `boolean` | add pseudo-entries to the digest for the "unhashed" variant of hashed original files

### Example usage

```javascript
const { S3Sync } = require('s3-asset-uploader')

const config =  {
  key: '<aws-access-key-id>',
  secret: '<aws-secret-access-key>',
  bucket: '<aws-s3-bucket-name>'
}
const options = {
  path: './public',
  ignorePaths: ['js/vendor', '.DS_Store'],
  prefix: 'assets',
  digestFileKey: 'config/asset-map.json'
}

const s3SyncUploader = new S3Sync(config, options)
s3SyncUploader.run()
.then(digest => {
  console.log('S3 Sync complete! Digest: ', digest)
})
.catch(err => {
  console.error('S3 Sync failed: ', err)
})
```

### Debug logging

To see what's going on under the hood, add `s3-asset-uploader` to your `DEBUG` environment variable:

```sh
DEBUG=s3-asset-uploader
```

For more information on configuring the `debug` logger, see: https://github.com/visionmedia/debug#readme
