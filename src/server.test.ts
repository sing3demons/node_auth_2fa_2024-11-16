import route from './server'
import AppServer from './lib/route'
import request from 'supertest'

const appServer = new AppServer()
appServer.router(route)

jest.mock('./db/redis')

jest.mock('./db/schema', () => {
  return {
    usersTable: {
      findOne: jest.fn().mockResolvedValue({ id: 111 }),
    },
  }
})

jest.mock('./lib/logger/logger', () => {
  return {
    writeLogFile: jest.fn(),
  }
})

jest.mock('./lib/logger/detail', () => {
  return jest.fn().mockImplementation(() => {
    return {
      detailLog: {
        Input: [],
        Output: [],
      },
      addInputRequest: jest.fn(),
    }
  })
})

jest.mock('./lib/logger/summary', () => {
  return jest.fn().mockImplementation(() => {
    return {
      blockDetail: [],
      addField: jest.fn(),
      end: jest.fn(),
      isEnd: jest.fn().mockReturnValue(true),
    }
  })
})

describe('route', () => {
  it('should return 200', async () => {
    const res = await request(appServer.instance).get('/api/auth/me/111').set('Accept', 'application/json').query({
      name: 'test',
      email: "test",
      password: "test",
    })
    expect(res.status).toEqual(200)
    expect(res.body).toHaveProperty('id')
  })
})
