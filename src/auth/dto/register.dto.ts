import { Transform } from 'class-transformer'; import { IsString, Length, Matches } from 'class-validator'; import { LoginDto } from './login.dto';
export class RegisterDto extends LoginDto { @Transform(({ value }: { value: string }) => value.trim()) @IsString() @Length(2, 60) name!: string; }
