// packages/frontend/src/pages/bookings/CreateBooking.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import {
  Box,
  Card,
  CardContent,
  Stepper,
  Step,
  StepLabel,
  Button,
  Typography,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
  Chip,
  Autocomplete,
  InputAdornment,
  Alert,
  Paper,
  Divider,
  IconButton,
  Tooltip,
  FormHelperText,
} from '@mui/material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import {
  LocationOn as LocationIcon,
  WbSunny as WeatherIcon,
  AccessTime as TimeIcon,
  People as PeopleIcon,
  CameraAlt as CameraIcon,
  Euro as EuroIcon,
  AttachMoney as DollarIcon,
  Add as AddIcon,
  Remove as RemoveIcon,
  MyLocation as MyLocationIcon,
  Map as MapIcon,
} from '@mui/icons-material';
import dayjs, { Dayjs } from 'dayjs';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

import { useAppSelector } from '../../hooks/redux';
import { useCreateBookingMutation } from '../../store/api/bookingApi';
import { useGetClientsQuery } from '../../store/api/clientApi';
import { useGetUsersQuery } from '../../store/api/userApi';
import { useGetEquipmentQuery } from '../../store/api/equipmentApi';
import { useGetRoomsQuery } from '../../store/api/roomApi';
import { useCheckAvailabilityMutation } from '../../store/api/bookingApi';
import { useGetLocationSuggestionsQuery } from '../../store/api/locationApi';
import { useGetWeatherForecastQuery } from '../../store/api/weatherApi';
import LoadingButton from '../../components/common/LoadingButton';
import { LocationType, WeatherCondition } from '../../types/enums';
import { formatCurrency } from '../../utils/formatters';

// Fix Leaflet icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/images/marker-icon-2x.png',
  iconUrl: '/images/marker-icon.png',
  shadowUrl: '/images/marker-shadow.png',
});

const steps = ['Basic Details', 'Location & Schedule', 'Team & Equipment', 'Pricing & Review'];

const bookingTypes = [
  'Wedding',
  'Portrait',
  'Commercial',
  'Fashion',
  'Event',
  'Product',
  'Real Estate',
  'Food',
  'Corporate',
  'Other',
];

const weatherConditions = [
  { value: 'SUNNY', label: 'Sunny', icon: '☀️' },
  { value: 'PARTLY_CLOUDY', label: 'Partly Cloudy', icon: '⛅' },
  { value: 'CLOUDY', label: 'Cloudy', icon: '☁️' },
  { value: 'IDEAL', label: 'Ideal Conditions', icon: '✨' },
];

interface LocationPickerProps {
  position: [number, number] | null;
  onPositionChange: (position: [number, number]) => void;
}

function LocationPicker({ position, onPositionChange }: LocationPickerProps) {
  const MapEvents = () => {
    useMapEvents({
      click: (e) => {
        onPositionChange([e.latlng.lat, e.latlng.lng]);
      },
    });
    return null;
  };

  return (
    <MapContainer
      center={position || [40.7128, -74.0060]} // Default to NYC
      zoom={13}
      style={{ height: '300px', width: '100%' }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <MapEvents />
      {position && <Marker position={position} />}
    </MapContainer>
  );
}

export default function CreateBooking() {
  const navigate = useNavigate();
  const { studio } = useAppSelector((state) => state.auth);
  const [activeStep, setActiveStep] = useState(0);
  const [locationQuery, setLocationQuery] = useState('');
  const [mapPosition, setMapPosition] = useState<[number, number] | null>(null);

  // API Hooks
  const [createBooking, { isLoading: isCreating }] = useCreateBookingMutation();
  const { data: clients = [] } = useGetClientsQuery({});
  const { data: users = [] } = useGetUsersQuery({ role: 'photographer,videographer,assistant' });
  const { data: equipment = [] } = useGetEquipmentQuery({ status: 'available' });
  const { data: rooms = [] } = useGetRoomsQuery({});
  const [checkAvailability] = useCheckAvailabilityMutation();
  const { data: locationSuggestions } = useGetLocationSuggestionsQuery(
    { query: locationQuery },
    { skip: locationQuery.length < 3 }
  );

  // Weather hook (skip if not outdoor or no coordinates)
  const shouldFetchWeather = 
    formik.values.locationType === 'OUTDOOR' && 
    formik.values.locationLatitude && 
    formik.values.locationLongitude &&
    formik.values.startDateTime;

  const { data: weatherForecast } = useGetWeatherForecastQuery(
    {
      latitude: formik.values.locationLatitude!,
      longitude: formik.values.locationLongitude!,
      date: formik.values.startDateTime,
    },
    { skip: !shouldFetchWeather }
  );

  const validationSchema = Yup.object({
    // Step 1: Basic Details
    clientId: Yup.string().required('Client is required'),
    title: Yup.string().required('Title is required').max(200),
    type: Yup.string().required('Booking type is required'),
    description: Yup.string(),
    
    // Step 2: Location & Schedule
    locationType: Yup.string().required('Location type is required'),
    startDateTime: Yup.date().required('Start date/time is required').min(new Date(), 'Start time must be in the future'),
    endDateTime: Yup.date()
      .required('End date/time is required')
      .when('startDateTime', (startDateTime, schema) => {
        return startDateTime ? schema.min(startDateTime, 'End time must be after start time') : schema;
      }),
    location: Yup.string().when('locationType', {
      is: (val: string) => val !== 'STUDIO',
      then: (schema) => schema.required('Location is required for non-studio shoots'),
    }),
    locationAddress: Yup.string().when('locationType', {
      is: (val: string) => ['OUTDOOR', 'CLIENT_LOCATION', 'EVENT_VENUE'].includes(val),
      then: (schema) => schema.required('Address is required'),
    }),
    weatherRequired: Yup.boolean(),
    preferredWeather: Yup.array().when('weatherRequired', {
      is: true,
      then: (schema) => schema.min(1, 'Select at least one weather condition'),
    }),
    
    // Step 3: Team & Equipment
    assignments: Yup.array().of(
      Yup.object({
        userId: Yup.string().required(),
        role: Yup.string().required(),
        isPrimary: Yup.boolean(),
        rate: Yup.number().positive().nullable(),
      })
    ).min(1, 'At least one team member is required'),
    
    // Step 4: Pricing
    totalAmount: Yup.number().required('Total amount is required').positive('Amount must be positive'),
    depositAmount: Yup.number().min(0, 'Deposit cannot be negative'),
    currency: Yup.string().required('Currency is required'),
  });

  const formik = useFormik({
    initialValues: {
      clientId: '',
      title: '',
      type: '',
      description: '',
      locationType: 'STUDIO' as LocationType,
      location: '',
      locationAddress: '',
      locationCity: '',
      locationState: '',
      locationCountry: '',
      locationPostalCode: '',
      locationLatitude: null as number | null,
      locationLongitude: null as number | null,
      locationNotes: '',
      weatherRequired: false,
      preferredWeather: [] as WeatherCondition[],
      weatherBackupPlan: '',
      startDateTime: null as Dayjs | null,
      endDateTime: null as Dayjs | null,
      travelTime: 0,
      travelDistance: 0,
      bufferTimeBefore: 30,
      bufferTimeAfter: 30,
      assignments: [] as Array<{
        userId: string;
        role: string;
        isPrimary: boolean;
        rate: number | null;
      }>,
      equipmentIds: [] as string[],
      roomIds: [] as string[],
      totalAmount: 0,
      depositAmount: 0,
      discountAmount: 0,
      currency: studio?.defaultCurrency || 'USD',
      internalNotes: '',
      isRecurring: false,
      recurringPattern: null,
    },
    validationSchema,
    onSubmit: async (values) => {
      try {
        // Check final availability
        const availability = await checkAvailability({
          startDateTime: values.startDateTime!.toISOString(),
          endDateTime: values.endDateTime!.toISOString(),
          equipmentIds: values.equipmentIds,
          roomIds: values.roomIds,
          photographerIds: values.assignments.map(a => a.userId),
        }).unwrap();

        if (!availability.isAvailable) {
          formik.setErrors({ submit: 'Some resources are not available for the selected time' });
          return;
        }

        // Create booking
        const booking = await createBooking({
          ...values,
          startDateTime: values.startDateTime!.toISOString(),
          endDateTime: values.endDateTime!.toISOString(),
        }).unwrap();

        navigate(`/bookings/${booking.id}`);
      } catch (error: any) {
        formik.setErrors({ submit: error.data?.message || 'Failed to create booking' });
      }
    },
  });

  // Calculate duration when dates change
  useEffect(() => {
    if (formik.values.startDateTime && formik.values.endDateTime) {
      const duration = formik.values.endDateTime.diff(formik.values.startDateTime, 'hours', true);
      if (duration > 0) {
        // Auto-calculate price based on team rates and duration
        const teamCost = formik.values.assignments.reduce((total, assignment) => {
          const user = users.find(u => u.id === assignment.userId);
          const rate = assignment.rate || user?.hourlyRate || 0;
          return total + (rate * duration);
        }, 0);
        
        formik.setFieldValue('totalAmount', Math.round(teamCost));
      }
    }
  }, [formik.values.startDateTime, formik.values.endDateTime, formik.values.assignments]);

  // Update map position when coordinates change
  useEffect(() => {
    if (formik.values.locationLatitude && formik.values.locationLongitude) {
      setMapPosition([formik.values.locationLatitude, formik.values.locationLongitude]);
    }
  }, [formik.values.locationLatitude, formik.values.locationLongitude]);

  const handleNext = async () => {
    const fieldsToValidate = getFieldsForStep(activeStep);
    const errors = await formik.validateForm();
    const stepErrors = fieldsToValidate.some(field => errors[field]);

    if (!stepErrors) {
      setActiveStep((prev) => prev + 1);
    } else {
      fieldsToValidate.forEach(field => {
        formik.setFieldTouched(field, true);
      });
    }
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  const getFieldsForStep = (step: number): string[] => {
    switch (step) {
      case 0:
        return ['clientId', 'title', 'type'];
      case 1:
        return ['locationType', 'startDateTime', 'endDateTime', 'location', 'locationAddress'];
      case 2:
        return ['assignments'];
      case 3:
        return ['totalAmount', 'currency'];
      default:
        return [];
    }
  };

  const handleLocationSelect = (location: any) => {
    formik.setValues({
      ...formik.values,
      location: location.name,
      locationAddress: location.address,
      locationCity: location.city,
      locationState: location.state,
      locationCountry: location.country,
      locationPostalCode: location.postalCode,
      locationLatitude: location.latitude,
      locationLongitude: location.longitude,
    });
  };

  const handleGetCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          formik.setFieldValue('locationLatitude', latitude);
          formik.setFieldValue('locationLongitude', longitude);
          
          // Reverse geocode to get address
          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
            );
            const data = await response.json();
            if (data.address) {
              formik.setFieldValue('locationAddress', data.display_name);
              formik.setFieldValue('locationCity', data.address.city || data.address.town);
              formik.setFieldValue('locationState', data.address.state);
              formik.setFieldValue('locationCountry', data.address.country_code?.toUpperCase());
              formik.setFieldValue('locationPostalCode', data.address.postcode);
            }
          } catch (error) {
            console.error('Failed to reverse geocode:', error);
          }
        },
        (error) => {
          console.error('Failed to get location:', error);
        }
      );
    }
  };

  const renderStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Autocomplete
                options={clients}
                getOptionLabel={(option) => `${option.firstName} ${option.lastName} ${option.email ? `(${option.email})` : ''}`}
                value={clients.find(c => c.id === formik.values.clientId) || null}
                onChange={(_, value) => formik.setFieldValue('clientId', value?.id || '')}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Client"
                    required
                    error={formik.touched.clientId && Boolean(formik.errors.clientId)}
                    helperText={formik.touched.clientId && formik.errors.clientId}
                  />
                )}
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Booking Title"
                name="title"
                value={formik.values.title}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                error={formik.touched.title && Boolean(formik.errors.title)}
                helperText={formik.touched.title && formik.errors.title}
                required
                placeholder="e.g., Smith Wedding Photography"
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth required error={formik.touched.type && Boolean(formik.errors.type)}>
                <InputLabel>Booking Type</InputLabel>
                <Select
                  name="type"
                  value={formik.values.type}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  label="Booking Type"
                >
                  {bookingTypes.map((type) => (
                    <MenuItem key={type} value={type}>
                      {type}
                    </MenuItem>
                  ))}
                </Select>
                {formik.touched.type && formik.errors.type && (
                  <FormHelperText>{formik.errors.type}</FormHelperText>
                )}
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={3}
                label="Description"
                name="description"
                value={formik.values.description}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                placeholder="Add any special requirements or notes about this booking..."
              />
            </Grid>
          </Grid>
        );

      case 1:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <FormControl fullWidth required>
                <InputLabel>Location Type</InputLabel>
                <Select
                  name="locationType"
                  value={formik.values.locationType}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  label="Location Type"
                  startAdornment={
                    <InputAdornment position="start">
                      <LocationIcon />
                    </InputAdornment>
                  }
                >
                  <MenuItem value="STUDIO">Studio</MenuItem>
                  <MenuItem value="CLIENT_LOCATION">Client Location</MenuItem>
                  <MenuItem value="OUTDOOR">Outdoor</MenuItem>
                  <MenuItem value="EVENT_VENUE">Event Venue</MenuItem>
                  <MenuItem value="HOTEL">Hotel</MenuItem>
                  <MenuItem value="RESTAURANT">Restaurant</MenuItem>
                  <MenuItem value="OTHER">Other</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            {formik.values.locationType === 'STUDIO' ? (
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel>Studio Room</InputLabel>
                  <Select
                    multiple
                    value={formik.values.roomIds}
                    onChange={(e) => formik.setFieldValue('roomIds', e.target.value)}
                    label="Studio Room"
                    renderValue={(selected) => (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {selected.map((value) => (
                          <Chip
                            key={value}
                            label={rooms.find(r => r.id === value)?.name || value}
                            size="small"
                          />
                        ))}
                      </Box>
                    )}
                  >
                    {rooms.map((room) => (
                      <MenuItem key={room.id} value={room.id}>
                        {room.name} - {formatCurrency(room.pricePerHour, formik.values.currency)}/hr
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            ) : (
              <>
                <Grid item xs={12}>
                  <Autocomplete
                    freeSolo
                    options={locationSuggestions || []}
                    getOptionLabel={(option) => typeof option === 'string' ? option : option.name}
                    value={formik.values.location}
                    onInputChange={(_, value) => {
                      setLocationQuery(value);
                      formik.setFieldValue('location', value);
                    }}
                    onChange={(_, value) => {
                      if (typeof value === 'object' && value) {
                        handleLocationSelect(value);
                      }
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Location Name"
                        required
                        error={formik.touched.location && Boolean(formik.errors.location)}
                        helperText={formik.touched.location && formik.errors.location}
                        placeholder="e.g., Central Park, Empire State Building"
                        InputProps={{
                          ...params.InputProps,
                          endAdornment: (
                            <>
                              {params.InputProps.endAdornment}
                              <Tooltip title="Use current location">
                                <IconButton onClick={handleGetCurrentLocation} size="small">
                                  <MyLocationIcon />
                                </IconButton>
                              </Tooltip>
                            </>
                          ),
                        }}
                      />
                    )}
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Address"
                    name="locationAddress"
                    value={formik.values.locationAddress}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    error={formik.touched.locationAddress && Boolean(formik.errors.locationAddress)}
                    helperText={formik.touched.locationAddress && formik.errors.locationAddress}
                    required={['OUTDOOR', 'CLIENT_LOCATION', 'EVENT_VENUE'].includes(formik.values.locationType)}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="City"
                    name="locationCity"
                    value={formik.values.locationCity}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                  />
                </Grid>

                <Grid item xs={12} md={3}>
                  <TextField
                    fullWidth
                    label="State/Province"
                    name="locationState"
                    value={formik.values.locationState}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                  />
                </Grid>

                <Grid item xs={12} md={3}>
                  <TextField
                    fullWidth
                    label="Postal Code"
                    name="locationPostalCode"
                    value={formik.values.locationPostalCode}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                  />
                </Grid>

                {formik.values.locationType === 'OUTDOOR' && (
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" gutterBottom>
                      <MapIcon sx={{ verticalAlign: 'middle', mr: 1 }} />
                      Pin Location on Map
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 1 }}>
                      <LocationPicker
                        position={mapPosition}
                        onPositionChange={(position) => {
                          setMapPosition(position);
                          formik.setFieldValue('locationLatitude', position[0]);
                          formik.setFieldValue('locationLongitude', position[1]);
                        }}
                      />
                    </Paper>
                  </Grid>
                )}
              </>
            )}

            <Grid item xs={12} md={6}>
              <DateTimePicker
                label="Start Date & Time"
                value={formik.values.startDateTime}
                onChange={(value) => formik.setFieldValue('startDateTime', value)}
                slotProps={{
                  textField: {
                    fullWidth: true,
                    required: true,
                    error: formik.touched.startDateTime && Boolean(formik.errors.startDateTime),
                    helperText: formik.touched.startDateTime && formik.errors.startDateTime,
                  },
                }}
                minDateTime={dayjs()}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <DateTimePicker
                label="End Date & Time"
                value={formik.values.endDateTime}
                onChange={(value) => formik.setFieldValue('endDateTime', value)}
                slotProps={{
                  textField: {
                    fullWidth: true,
                    required: true,
                    error: formik.touched.endDateTime && Boolean(formik.errors.endDateTime),
                    helperText: formik.touched.endDateTime && formik.errors.endDateTime,
                  },
                }}
                minDateTime={formik.values.startDateTime || dayjs()}
              />
            </Grid>

            {formik.values.locationType !== 'STUDIO' && (
              <>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    label="Travel Time (minutes)"
                    name="travelTime"
                    value={formik.values.travelTime}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <TimeIcon />
                        </InputAdornment>
                      ),
                    }}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    type="number"
                    label="Travel Distance (km)"
                    name="travelDistance"
                    value={formik.values.travelDistance}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                  />
                </Grid>
              </>
            )}

            {formik.values.locationType === 'OUTDOOR' && (
              <>
                <Grid item xs={12}>
                  <Divider sx={{ my: 2 }}>
                    <Chip icon={<WeatherIcon />} label="Weather Requirements" />
                  </Divider>
                </Grid>

                <Grid item xs={12}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={formik.values.weatherRequired}
                        onChange={(e) => formik.setFieldValue('weatherRequired', e.target.checked)}
                      />
                    }
                    label="This shoot has specific weather requirements"
                  />
                </Grid>

                {formik.values.weatherRequired && (
                  <>
                    <Grid item xs={12}>
                      <Typography variant="subtitle2" gutterBottom>
                        Preferred Weather Conditions
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {weatherConditions.map((condition) => (
                          <Chip
                            key={condition.value}
                            label={`${condition.icon} ${condition.label}`}
                            onClick={() => {
                              const current = formik.values.preferredWeather;
                              const updated = current.includes(condition.value as WeatherCondition)
                                ? current.filter(w => w !== condition.value)
                                : [...current, condition.value as WeatherCondition];
                              formik.setFieldValue('preferredWeather', updated);
                            }}
                            color={formik.values.preferredWeather.includes(condition.value as WeatherCondition) ? 'primary' : 'default'}
                            variant={formik.values.preferredWeather.includes(condition.value as WeatherCondition) ? 'filled' : 'outlined'}
                          />
                        ))}
                      </Box>
                      {formik.touched.preferredWeather && formik.errors.preferredWeather && (
                        <FormHelperText error>{formik.errors.preferredWeather}</FormHelperText>
                      )}
                    </Grid>

                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        multiline
                        rows={2}
                        label="Weather Backup Plan"
                        name="weatherBackupPlan"
                        value={formik.values.weatherBackupPlan}
                        onChange={formik.handleChange}
                        onBlur={formik.handleBlur}
                        placeholder="What's the plan if weather conditions aren't ideal?"
                      />
                    </Grid>
                  </>
                )}

                {weatherForecast && (
                  <Grid item xs={12}>
                    <Alert severity={weatherForecast.isIdeal ? 'success' : 'warning'} icon={<WeatherIcon />}>
                      <Typography variant="subtitle2">
                        Weather Forecast for {dayjs(formik.values.startDateTime).format('MMM D, YYYY')}
                      </Typography>
                      <Typography variant="body2">
                        {weatherForecast.description} - {weatherForecast.temperature}°C
                        {weatherForecast.warnings && (
                          <Box component="span" sx={{ color: 'warning.main', ml: 1 }}>
                            ⚠️ {weatherForecast.warnings}
                          </Box>
                        )}
                      </Typography>
                    </Alert>
                  </Grid>
                )}
              </>
            )}

            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Location Notes"
                name="locationNotes"
                value={formik.values.locationNotes}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                placeholder="Parking info, access instructions, special requirements..."
              />
            </Grid>
          </Grid>
        );

      case 2:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                <PeopleIcon sx={{ verticalAlign: 'middle', mr: 1 }} />
                Team Assignment
              </Typography>
              
              {formik.values.assignments.map((assignment, index) => (
                <Paper key={index} variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} md={4}>
                      <Autocomplete
                        options={users}
                        getOptionLabel={(option) => `${option.firstName} ${option.lastName}`}
                        value={users.find(u => u.id === assignment.userId) || null}
                        onChange={(_, value) => {
                          const newAssignments = [...formik.values.assignments];
                          newAssignments[index].userId = value?.id || '';
                          formik.setFieldValue('assignments', newAssignments);
                        }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Team Member"
                            size="small"
                            required
                          />
                        )}
                      />
                    </Grid>
                    
                    <Grid item xs={12} md={3}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Role</InputLabel>
                        <Select
                          value={assignment.role}
                          onChange={(e) => {
                            const newAssignments = [...formik.values.assignments];
                            newAssignments[index].role = e.target.value;
                            formik.setFieldValue('assignments', newAssignments);
                          }}
                          label="Role"
                        >
                          <MenuItem value="photographer">Photographer</MenuItem>
                          <MenuItem value="videographer">Videographer</MenuItem>
                          <MenuItem value="assistant">Assistant</MenuItem>
                          <MenuItem value="editor">Editor</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    
                    <Grid item xs={12} md={2}>
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        label="Rate/hr"
                        value={assignment.rate || ''}
                        onChange={(e) => {
                          const newAssignments = [...formik.values.assignments];
                          newAssignments[index].rate = e.target.value ? Number(e.target.value) : null;
                          formik.setFieldValue('assignments', newAssignments);
                        }}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              {formik.values.currency === 'EUR' ? <EuroIcon /> : <DollarIcon />}
                            </InputAdornment>
                          ),
                        }}
                      />
                    </Grid>
                    
                    <Grid item xs={12} md={2}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={assignment.isPrimary}
                            onChange={(e) => {
                              const newAssignments = [...formik.values.assignments];
                              // Only one can be primary
                              newAssignments.forEach((a, i) => {
                                a.isPrimary = i === index && e.target.checked;
                              });
                              formik.setFieldValue('assignments', newAssignments);
                            }}
                          />
                        }
                        label="Primary"
                      />
                    </Grid>
                    
                    <Grid item xs={12} md={1}>
                      <IconButton
                        color="error"
                        onClick={() => {
                          const newAssignments = formik.values.assignments.filter((_, i) => i !== index);
                          formik.setFieldValue('assignments', newAssignments);
                        }}
                      >
                        <RemoveIcon />
                      </IconButton>
                    </Grid>
                  </Grid>
                </Paper>
              ))}
              
              <Button
                startIcon={<AddIcon />}
                onClick={() => {
                  formik.setFieldValue('assignments', [
                    ...formik.values.assignments,
                    { userId: '', role: 'photographer', isPrimary: false, rate: null }
                  ]);
                }}
              >
                Add Team Member
              </Button>
              
              {formik.touched.assignments && formik.errors.assignments && (
                <FormHelperText error>{formik.errors.assignments}</FormHelperText>
              )}
            </Grid>

            <Grid item xs={12}>
              <Divider sx={{ my: 2 }} />
            </Grid>

            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                <CameraIcon sx={{ verticalAlign: 'middle', mr: 1 }} />
                Equipment
              </Typography>
              
              <Autocomplete
                multiple
                options={equipment}
                getOptionLabel={(option) => `${option.name} (${option.brand} ${option.model})`}
                value={equipment.filter(e => formik.values.equipmentIds.includes(e.id))}
                onChange={(_, value) => {
                  formik.setFieldValue('equipmentIds', value.map(v => v.id));
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select Equipment"
                    placeholder="Choose equipment..."
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option.name}
                      {...getTagProps({ index })}
                    />
                  ))
                }
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                label="Buffer Time Before (minutes)"
                name="bufferTimeBefore"
                value={formik.values.bufferTimeBefore}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                helperText="Setup time before the shoot"
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                label="Buffer Time After (minutes)"
                name="bufferTimeAfter"
                value={formik.values.bufferTimeAfter}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                helperText="Cleanup time after the shoot"
              />
            </Grid>
          </Grid>
        );

      case 3:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Pricing Details
              </Typography>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                label="Total Amount"
                name="totalAmount"
                value={formik.values.totalAmount}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                error={formik.touched.totalAmount && Boolean(formik.errors.totalAmount)}
                helperText={formik.touched.totalAmount && formik.errors.totalAmount}
                required
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      {formik.values.currency === 'EUR' ? <EuroIcon /> : <DollarIcon />}
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <FormControl fullWidth required>
                <InputLabel>Currency</InputLabel>
                <Select
                  name="currency"
                  value={formik.values.currency}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  label="Currency"
                >
                  <MenuItem value="USD">USD - US Dollar</MenuItem>
                  <MenuItem value="EUR">EUR - Euro</MenuItem>
                  <MenuItem value="GBP">GBP - British Pound</MenuItem>
                  <MenuItem value="AED">AED - UAE Dirham</MenuItem>
                  <MenuItem value="JPY">JPY - Japanese Yen</MenuItem>
                  <MenuItem value="AUD">AUD - Australian Dollar</MenuItem>
                  <MenuItem value="CAD">CAD - Canadian Dollar</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                label="Deposit Amount"
                name="depositAmount"
                value={formik.values.depositAmount}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                error={formik.touched.depositAmount && Boolean(formik.errors.depositAmount)}
                helperText={formik.touched.depositAmount && formik.errors.depositAmount}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      {formik.values.currency === 'EUR' ? <EuroIcon /> : <DollarIcon />}
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                type="number"
                label="Discount Amount"
                name="discountAmount"
                value={formik.values.discountAmount}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      {formik.values.currency === 'EUR' ? <EuroIcon /> : <DollarIcon />}
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                rows={3}
                label="Internal Notes"
                name="internalNotes"
                value={formik.values.internalNotes}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                helperText="These notes are only visible to staff"
              />
            </Grid>

            <Grid item xs={12}>
              <Divider sx={{ my: 2 }} />
            </Grid>

            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Booking Summary
              </Typography>
              
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">Client</Typography>
                    <Typography variant="body1">
                      {clients.find(c => c.id === formik.values.clientId)?.firstName}{' '}
                      {clients.find(c => c.id === formik.values.clientId)?.lastName}
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">Type</Typography>
                    <Typography variant="body1">{formik.values.type}</Typography>
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">Date & Time</Typography>
                    <Typography variant="body1">
                      {formik.values.startDateTime?.format('MMM D, YYYY h:mm A')} - 
                      {formik.values.endDateTime?.format('h:mm A')}
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">Duration</Typography>
                    <Typography variant="body1">
                      {formik.values.startDateTime && formik.values.endDateTime
                        ? `${formik.values.endDateTime.diff(formik.values.startDateTime, 'hours', true)} hours`
                        : '-'}
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">Location</Typography>
                    <Typography variant="body1">
                      {formik.values.locationType === 'STUDIO' 
                        ? `Studio - ${rooms.filter(r => formik.values.roomIds.includes(r.id)).map(r => r.name).join(', ')}`
                        : `${formik.values.location} - ${formik.values.locationAddress}`}
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">Team</Typography>
                    <Typography variant="body1">
                      {formik.values.assignments.map((a, i) => {
                        const user = users.find(u => u.id === a.userId);
                        return user ? `${user.firstName} ${user.lastName} (${a.role})` : '';
                      }).filter(Boolean).join(', ')}
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12}>
                    <Divider />
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">Total Amount</Typography>
                    <Typography variant="h6">
                      {formatCurrency(formik.values.totalAmount, formik.values.currency)}
                    </Typography>
                  </Grid>
                  
                  <Grid item xs={12} md={6}>
                    <Typography variant="body2" color="text.secondary">Deposit Required</Typography>
                    <Typography variant="h6">
                      {formatCurrency(formik.values.depositAmount, formik.values.currency)}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>

            {formik.errors.submit && (
              <Grid item xs={12}>
                <Alert severity="error">{formik.errors.submit}</Alert>
              </Grid>
            )}
          </Grid>
        );

      default:
        return null;
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Create New Booking
      </Typography>

      <Card>
        <CardContent>
          <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
            {steps.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          <form onSubmit={formik.handleSubmit}>
            {renderStepContent(activeStep)}

            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
              <Button
                disabled={activeStep === 0}
                onClick={handleBack}
              >
                Back
              </Button>
              
              <Box>
                {activeStep === steps.length - 1 ? (
                  <LoadingButton
                    type="submit"
                    variant="contained"
                    loading={isCreating}
                  >
                    Create Booking
                  </LoadingButton>
                ) : (
                  <Button
                    variant="contained"
                    onClick={handleNext}
                  >
                    Next
                  </Button>
                )}
              </Box>
            </Box>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}