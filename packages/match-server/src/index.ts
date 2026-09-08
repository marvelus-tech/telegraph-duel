import { MatchRoom } from './MatchRoom';
import { ScoreBoard } from './ScoreBoard';
import type { CreateRoomRequest } from './types';

export { MatchRoom, ScoreBoard };

interface Env {
  MATCH_ROOM: DurableObjectNamespace;
  SCORE_BOARD: DurableObjectNamespace;
  BRIDGE_TOKEN?: string;
}

function generateRoomId(): string {
  return 'rm_' + Math.random().toString(36).substring(2, 15);
}

function corsHeaders(origin?: string | null): HeadersInit {
  const allowedOrigins = [
    'https://marvelus-tech.github.io',
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173',
  ];

  const requestOrigin = origin || '*';
  const allowOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Bridge-Token',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(origin),
      });
    }

    if (url.pathname === '/scores' && request.method === 'GET') {
      const id = env.SCORE_BOARD.idFromName('arena');
      const board = env.SCORE_BOARD.get(id);
      const boardResponse = await board.fetch(new Request('https://board/scores'));
      const newHeaders = new Headers(boardResponse.headers);
      Object.entries(corsHeaders(origin)).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      return new Response(boardResponse.body, {
        status: boardResponse.status,
        headers: newHeaders,
      });
    }

    if (url.pathname === '/rooms' && request.method === 'POST') {
      try {
        const body = await request.json() as CreateRoomRequest;
        const roomId = body.matchId || generateRoomId();
        
        const id = env.MATCH_ROOM.idFromName(roomId);
        const room = env.MATCH_ROOM.get(id);
        
        const initRequest = new Request('http://do/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, config: body.config || {} }),
        });

        const initResponse = await room.fetch(initRequest);
        
        if (!initResponse.ok) {
          return new Response(JSON.stringify({ error: 'Failed to initialize room' }), {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders(origin),
            },
          });
        }

        return new Response(JSON.stringify({
          roomId,
          status: 'waiting',
          createdAt: new Date().toISOString(),
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(origin),
          },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid request body' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(origin),
          },
        });
      }
    }

    const roomMatch = url.pathname.match(/^\/rooms\/([^/]+)(\/.*)?$/);
    if (roomMatch) {
      const roomId = roomMatch[1];
      const subpath = roomMatch[2] || '';

      const id = env.MATCH_ROOM.idFromName(roomId);
      const room = env.MATCH_ROOM.get(id);

      const roomUrl = new URL(request.url);
      roomUrl.pathname = subpath || '/';

      const roomRequest = new Request(roomUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });

      const response = await room.fetch(roomRequest);

      if (response.status === 101) {
        return response;
      }

      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders(origin)).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    return new Response('Not found', { 
      status: 404,
      headers: corsHeaders(origin),
    });
  },
};
