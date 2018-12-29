## AWS S3 asset uploader

[![Greenkeeper badge](https://badges.greenkeeper.io/mix/s3-asset-uploader.svg)](https://greenkeeper.io/)

for putting assets on s3

``` js
const { S3Sync } = require('s3-asset-uploader')

const config =  {
  "key": "<key>",
  "secret": "<secret>",
  "bucket": "<s3-bucket-name>"
}
const options = {
  path: './public',
  ignorePaths: ['public/js/vendor'],
  prefix: '/assets',
  digestFileName: 'config/asset-map.json',
  digestOnly: false
}

const sync = new S3Sync(config, options)
sync.run().then(digest => {
  console.log('Synchronized with S3! Digest: ', digest)
})
```
