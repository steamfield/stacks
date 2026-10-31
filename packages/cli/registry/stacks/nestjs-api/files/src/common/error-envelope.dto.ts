import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { type ErrorCode, errorTable } from './errors.js';

/** OpenAPI shapes of the error envelope; errors.ts::envelope builds it. */
export class Issue {
  @ApiProperty({ example: 'title' })
  path: string;

  @ApiProperty({ example: 'title should not be empty' })
  message: string;
}

export class ErrorDetail {
  @ApiProperty({ enum: Object.keys(errorTable) })
  code: ErrorCode;

  @ApiProperty()
  message: string;

  @ApiProperty()
  requestId: string;

  @ApiPropertyOptional({ type: [Issue] })
  issues?: Issue[];
}

export class ErrorEnvelope {
  @ApiProperty({ type: ErrorDetail })
  error: ErrorDetail;
}
