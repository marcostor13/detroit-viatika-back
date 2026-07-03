/**
 * Migración: agrega type='rendicion' a todos los ExpenseReport que no tengan el campo.
 * Ejecutar UNA SOLA VEZ antes del primer deploy del flujo unificado de viáticos.
 *
 * Uso: npx ts-node -r tsconfig-paths/register src/scripts/migrate-expense-report-type.ts
 */
import * as mongoose from 'mongoose'
import * as dotenv from 'dotenv'

dotenv.config()

async function run() {
  const uri = process.env.MONGODB_URI ?? process.env.DB_URI
  if (!uri) throw new Error('Variable de entorno MONGODB_URI o DB_URI no definida')

  await mongoose.connect(uri)
  console.log('Conectado a MongoDB')

  const collection = mongoose.connection.collection('expensereports')

  const result = await collection.updateMany(
    { type: { $exists: false } },
    { $set: { type: 'rendicion' } }
  )

  console.log(`Actualizados: ${result.modifiedCount} documentos`)
  await mongoose.disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
