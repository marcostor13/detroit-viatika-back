export class ChatMessageDto {
  role: 'user' | 'assistant'
  content: string
}

export class ChatRequestDto {
  messages: ChatMessageDto[]
}
