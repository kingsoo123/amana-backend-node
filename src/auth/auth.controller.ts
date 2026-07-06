import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { BearerToken } from './decorators/bearer-token.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('logout')
  logout(@BearerToken() token?: string) {
    return this.authService.logout(token);
  }
}
