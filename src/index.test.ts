import { route } from './index'
import AppServer from './lib/route'
import request from 'supertest';


const appServer = new AppServer()
appServer.router(route)


jest.mock('./db/schema', () => {
  return {
    usersTable: {
      findOne: jest.fn().mockResolvedValue({ id: 111 })
    }
  }
})

describe('route', () => {

  it('should return 200', async () => {
    const res = await request(appServer.instance).get('/api/auth/me/111').set('Accept', 'application/json')
    expect(res.status).toEqual(200)
  })
})
