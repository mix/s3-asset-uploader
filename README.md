## AWS S3 asset uploader
for putting assets on s3

``` js
var Sync = require('s3-asset-uploader').S3sync
var config =  {
    "key": "<key>"
  , "secret": "<secret>"
  , "bucket": "<bucket-name>"
  , "cloudfront": "<cf-domain>"
}

new Sync(config, {
    path: './public'
  , prefix: '/assets'
  , ignorePath: './public/js/vendor'
  , digest: 'config/asset-map.json'
})
```
