import { useState } from 'react'

// Minimal controlled-form helper: keeps values, tracks which fields were touched,
// and derives validation errors from a pure `validate(values)` function. No
// external dependency — deliberately small to match Plainlane's stack.
//
//   const form = useForm({ name: '' }, (v) => v.name ? {} : { name: 'Required.' })
//   form.values.name           // current value
//   form.errors.name           // message or undefined
//   form.isValid               // true when errors is empty
//   form.field('name')         // { value, onChange, onBlur } for an <input>
//   form.showError('name')     // only after the field was touched
export function useForm(initialValues, validate) {
  const [values, setValues] = useState(initialValues)
  const [touched, setTouched] = useState({})

  const errors = validate(values) || {}
  const isValid = Object.keys(errors).length === 0

  const setValue = (name, value) => setValues((v) => ({ ...v, [name]: value }))
  const markTouched = (name) => setTouched((t) => (t[name] ? t : { ...t, [name]: true }))
  const markAllTouched = () => setTouched(Object.fromEntries(Object.keys(values).map((k) => [k, true])))
  const showError = (name) => (touched[name] ? errors[name] : undefined)

  const field = (name) => ({
    value: values[name],
    onChange: (e) => setValue(name, e.target.value),
    onBlur: () => markTouched(name),
  })

  return { values, errors, isValid, touched, setValue, markTouched, markAllTouched, showError, field }
}
