import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import fjwt from '@fastify/jwt';
import { config } from '../config';
import { UserRole } from '../models';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { id: string; username: string; role: UserRole };
    user: { id: string; username: string; role: UserRole };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (...roles: UserRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function authPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fjwt, {
    secret: config.jwt.secret,
    sign: { expiresIn: config.jwt.expiresIn },
  });

  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
    }
  });

  fastify.decorate('authorize', function (...roles: UserRole[]) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch (err) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
      }
      if (!roles.includes(request.user.role)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Insufficient permissions' });
      }
    };
  });
}

export default fp(authPlugin, { name: 'auth' });
