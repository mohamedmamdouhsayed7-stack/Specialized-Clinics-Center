import { IsNotEmpty, IsUUID } from 'class-validator';

export class LinkAppointmentPatientDto {
  @IsUUID()
  @IsNotEmpty()
  patientId: string;
}
