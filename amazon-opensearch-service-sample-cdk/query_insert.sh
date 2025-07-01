
#----- 2) insert data to /books index
PUT /books
Host: search-os-service-domain-2-sjs2b4wmpcdxszjckj7prf655u.ap-northeast-1.es.amazonaws.com
Content-Type: application/json

{
  "settings": {
    "index": {
      "number_of_shards": 1,
      "number_of_replicas": 1
    }
  },
  "mappings": {
    "properties": {
      "title": { "type": "text" },
      "author": { "type": "text" },
      "year": { "type": "integer" },
      "genre": { "type": "keyword" }
    }
  }
}