import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Types } from 'mongoose'

export interface RoleDocument {
  name: string
}

export interface GetRoleDocument extends RoleDocument {
  _id: Types.ObjectId
}

@Schema({ timestamps: true })
export class Role {
  @Prop()
  name: string

  @Prop({ default: true })
  active: boolean
}

export const RoleSchema = SchemaFactory.createForClass(Role)
