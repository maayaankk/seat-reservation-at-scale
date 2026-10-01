import Fastify from 'fastify';

const app = Fastify({ logger: false });

app.get('/health', async () => {
  return { status: 'ok', message: 'Hello World' };
});

app.get('/', async () => {
  return { message: 'Hello World API' };
});

async function main() {
  try {
    await app.listen({ port: 8080, host: '0.0.0.0' });
    console.log('Server started on http://localhost:8080');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();