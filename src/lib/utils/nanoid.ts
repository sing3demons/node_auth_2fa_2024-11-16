import { customAlphabet } from 'nanoid'

export default class NanoIdService {
  private readonly alphanum = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  private readonly len = 11

  randomNanoId(): string {
    const nanoid = customAlphabet(this.alphanum, this.len)
    return nanoid()
  }

  randomNanoIdWithLen(len: number): string {
    const nanoid = customAlphabet(this.alphanum, len)
    return nanoid()
  }
}