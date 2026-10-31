import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';

export class Health {
  @ApiProperty({ enum: ['ok'] })
  status: 'ok';
}

/** Liveness for verify, load balancers and the container health check. */
@ApiTags('health')
@Controller({ path: 'healthz', version: VERSION_NEUTRAL })
export class HealthController {
  @Get()
  @ApiOkResponse({ type: Health, description: 'The server is up' })
  check(): Health {
    return { status: 'ok' };
  }
}
