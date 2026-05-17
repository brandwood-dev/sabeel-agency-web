export class ChangePasswordDto {
  currentPassword?: string; // Optional because it's also used in reset flow where current pwd is unknown
  newPassword: string;
  confirmPassword: string;
}
