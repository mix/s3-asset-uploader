## AWS S3 asset uploader
for putting assets on s3

``` js
var Sync = expa.util('s3-sync').S3sync
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
