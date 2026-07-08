const { MongoMemoryServer } = require('mongodb-memory-server')

module.exports = async function globalSetup() {
  const mongod = await MongoMemoryServer.create()
  process.env.MONGO_URI = mongod.getUri()
  process.env.EMAILS_ENABLED = 'false'
  global.__MONGOD__ = mongod
}
