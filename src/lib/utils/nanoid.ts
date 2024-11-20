import { customAlphabet } from 'nanoid'

const alphanum = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

const genNanoId = (size: number) => {
  const nanoid = customAlphabet(alphanum, size)
  return nanoid()
}

export { genNanoId }
